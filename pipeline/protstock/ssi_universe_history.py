"""Stage and publish SSI history for the locked universe."""
from argparse import ArgumentParser
from contextlib import closing
from datetime import date, datetime, timedelta
from decimal import Decimal
import gzip
from hashlib import sha256
import json

import httpx

from .config import Settings
from .market_http import SourceUnavailable
from .market_radar_tape import integer
from .market_sources import VN
from .models import DailyBar
from .price_basis import canonical_price_rows, source_family, source_version
from .provider_market import INDEX_PRICE_UNIT, MarketDataProvider, ProviderDataError
from .research_archive import BUCKET, STORAGE_BUDGET
from .ssi_market_data import market_data
from .ssi_price_rollout import ROLLOUT_LIMIT, archive_price_window, rollout_symbols, verify_price_window
from .supabase_rest import SupabaseRestClient

PRICES_START = date(2021, 1, 1)
FLOW_START = date(2026, 9, 11)
FOREIGN_FIELDS = {
    "buy_volume": "totalForeignBuy", "sell_volume": "totalForeignSell",
    "buy_value": "totalForeignBuyValue", "sell_value": "totalForeignSellValue",
}


def stage_path(db):
    return f"{db._settings.supabase_url}/storage/v1/object"


def read_staged(db, symbol):
    response = db._request("GET", f"{stage_path(db)}/authenticated/{BUCKET}/ssi-history/v1/{symbol}.json.gz")
    if response.status_code in {400, 404}:
        return None
    response.raise_for_status()
    payload = json.loads(gzip.decompress(response.content))
    if payload.get("symbol") != symbol or payload.get("prices_start") != PRICES_START.isoformat():
        raise ValueError("SSI history object identity mismatch")
    return payload


def publish_staged(db, payload):
    blob = gzip.compress(json.dumps(payload, separators=(",", ":")).encode(), mtime=0)
    response = db._request("POST", "/rpc/protstock_storage_bytes", json={})
    response.raise_for_status()
    if int(response.json()) + len(blob) >= STORAGE_BUDGET:
        raise RuntimeError("SSI history staging deferred at the Storage limit")
    url = stage_path(db)
    key = f"{BUCKET}/ssi-history/v1/{payload['symbol']}.json.gz"
    db._request("POST", f"{url}/{key}", content=blob,
                headers={"Content-Type": "application/gzip", "x-upsert": "true"}).raise_for_status()
    uploaded = db._request("GET", f"{url}/authenticated/{key}")
    uploaded.raise_for_status()
    if sha256(uploaded.content).digest() != sha256(blob).digest():
        raise RuntimeError("SSI history archive did not pass read-back verification")


def pack(bar):
    return [bar.trading_date.isoformat(), *[str(getattr(bar, field)) for field in ("open", "high", "low", "close")], bar.volume]


def cutover_history(db, provider, symbol, end):
    """Reuse a verified object while fetching the latest SSI overlap directly."""
    try:
        payload = read_staged(db, symbol)
    except (httpx.HTTPError, ValueError, OSError):
        return provider.history(symbol, PRICES_START, end)
    if payload and payload["prices"]:
        stamp = datetime.fromisoformat(payload["created_at"])
        saved = [DailyBar(symbol, date.fromisoformat(day), Decimal(o), Decimal(h), Decimal(l),
                          Decimal(c), volume, "SSI_FASTCONNECT", stamp)
                 for day, o, h, l, c, volume in payload["prices"] if day <= end.isoformat()]
        if saved and end - saved[-1].trading_date <= timedelta(days=14):
            latest = provider.history(symbol, saved[-1].trading_date, end)
            if latest and pack(saved[-1]) == pack(latest[0]) and latest[-1].trading_date == end:
                return saved[:-1] + latest
    return provider.history(symbol, PRICES_START, end)


def foreign_window(symbol, day):
    summaries = market_data().summaries(symbol, FLOW_START, day)
    return {when.isoformat(): {field: integer(row[key]) for field, key in FOREIGN_FIELDS.items()}
            for when, row in summaries.items()
            if all(row.get(key) not in (None, "") for key in FOREIGN_FIELDS.values())}


def publish_foreign_window(db, item, payload, eligible_days):
    from .market_radar import market_row, storage_used

    if storage_used(db) >= ROLLOUT_LIMIT:
        return 0
    flow = payload.get("foreign", {})
    existing = {row["trading_date"]: row for row in db._pages("market_radar_daily", {
        "symbol": f"eq.{item['symbol']}", "exchange": f"eq.{item['exchange']}", "category": "eq.foreign",
        "method": "eq.total", "trading_date": f"gte.{min(eligible_days)}",
        "select": "trading_date,source,holdings,ownership_pct,room_remaining", "order": "trading_date.asc",
    })}
    rows = []
    for when in sorted(eligible_days & flow.keys()):
        old = existing.get(when, {})
        if old.get("source") == "SSI FastConnect":
            continue
        rows.append(market_row(date.fromisoformat(when), item["exchange"], item["symbol"], "foreign", "total", "SSI FastConnect",
                               **flow[when], **{key: old.get(key) for key in ("holdings", "ownership_pct", "room_remaining")}))
    return db.upsert("market_radar_daily", rows, "trading_date,exchange,symbol,category,method")


def latest_sessions(db):
    index = db.market_index("VNINDEX")
    today = datetime.now(VN).date()
    days = sorted(db.index_price_dates(index["id"], FLOW_START, today))[-50:]
    if not days:
        raise RuntimeError("No published sessions for SSI staging")
    return index, days


def run(db, shard, shards):
    market_data().authenticate()
    _, days = latest_sessions(db)
    day = date.fromisoformat(days[-1])
    provider = MarketDataProvider("SSI")
    universe = [{"symbol": "VNINDEX"}, *db.active_symbols()]
    staged = 0
    for item in universe[shard::shards]:
        symbol = item["symbol"]
        is_stock = item.get("exchange") in {"HOSE", "HNX", "UPCOM"}
        try:
            payload = read_staged(db, symbol)
            if not payload or payload["end"] < (day - timedelta(days=7)).isoformat():
                prices = provider.history(symbol, PRICES_START, day)
                if not prices:
                    raise ValueError("No SSI daily candles")
                payload = {"symbol": symbol, "prices_start": PRICES_START.isoformat(), "flow_start": FLOW_START.isoformat(),
                           "end": day.isoformat(), "created_at": datetime.now(VN).isoformat(),
                           "prices": [pack(bar) for bar in prices], "foreign": {}}
                publish_staged(db, payload)
            staged += 1
            if is_stock and payload.get("foreign_end") != payload["end"]:
                payload["foreign"] = foreign_window(symbol, date.fromisoformat(payload["end"]))
                payload["foreign_end"] = payload["end"]
                publish_staged(db, payload)
            reports = publish_foreign_window(db, item, payload, set(days)) if is_stock else 0
            print(f"{symbol}: {len(payload['prices'])} price sessions, {len(payload['foreign'])} foreign reports staged, {reports} reports published", flush=True)
        except Exception as error:
            report_deferred(symbol, error)
    if not staged:
        raise RuntimeError("No SSI history staged in this shard")


def report_deferred(symbol, error):
    # Raw HTTP errors can contain the signed file download URL.
    detail = str(error) if isinstance(error, (SourceUnavailable, ProviderDataError)) else type(error).__name__
    print(f"::warning::{symbol} SSI history deferred: {detail}", flush=True)


def promote(db, limit):
    from .market_radar import storage_used

    index, days = latest_sessions(db)
    day = date.fromisoformat(days[-1])
    pending = rollout_symbols(db, day, None)
    if storage_used(db) >= ROLLOUT_LIMIT:
        return
    market_data().authenticate()
    provider = MarketDataProvider("SSI")
    index_rows = db._pages("market_index_prices", {
        "select": "*", "index_id": f"eq.{index['id']}", "trading_date": f"gte.{PRICES_START}",
        "order": "trading_date.asc",
    })
    if index_rows and source_family(index_rows[-1]["source"]) != "SSI":
        try:
            bars = cutover_history(db, provider, "VNINDEX", day)
            if not bars or bars[-1].trading_date != day:
                raise ProviderDataError("VNINDEX missing the latest completed session")
            verify_price_window(index_rows, bars)
            archive_price_window(db, "market_index_prices", index["id"], index_rows)
            db.upsert("market_index_prices", [{
                "index_id": index["id"], "trading_date": bar.trading_date.isoformat(),
                "open": float(bar.open), "high": float(bar.high), "low": float(bar.low), "close": float(bar.close),
                "volume": bar.volume, "source": bar.source, "price_unit": INDEX_PRICE_UNIT,
                "source_version": source_version(bar.source), "collected_at": bar.collected_at.isoformat(),
            } for bar in bars], "index_id,trading_date")
            print(f"VNINDEX: {len(bars)} SSI sessions published", flush=True)
        except Exception as error:
            report_deferred("VNINDEX", error)

    active = {item["symbol"]: item for item in db.active_symbols()}
    published = 0
    for symbol in pending:
        if published >= limit or storage_used(db) >= ROLLOUT_LIMIT:
            break
        try:
            symbol_id = active[symbol]["id"]
            if not read_staged(db, symbol):
                continue
            bars = cutover_history(db, provider, symbol, day)
            if not bars or bars[-1].trading_date != day:
                raise ProviderDataError("SSI missing the latest completed session")
            previous = db._pages("daily_prices", {
                "select": "*", "symbol_id": f"eq.{symbol_id}", "trading_date": f"gte.{PRICES_START}",
                "order": "trading_date.asc",
            })
            verify_price_window(previous, bars)
            archive_price_window(db, "daily_prices", symbol_id, previous)
            rows = canonical_price_rows(symbol_id, bars, [], as_of_date=day)
            response = db._request("POST", "/rpc/publish_ssi_price_series", json={
                "p_symbol_id": symbol_id, "p_rows": rows,
            })
            response.raise_for_status()
            published += 1
            print(f"{symbol}: {response.json()} SSI sessions published", flush=True)
        except Exception as error:
            report_deferred(symbol, error)
    print(f"SSI rollout: {published}/{len(pending)} pending stocks published. PostgreSQL: {storage_used(db):,} bytes.", flush=True)


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--shards", type=int, default=1)
    parser.add_argument("--promote", type=int, metavar="MAX_SYMBOLS")
    args = parser.parse_args()
    if not 0 <= args.shard < args.shards:
        parser.error("Invalid shard")
    if args.promote is not None and not 1 <= args.promote <= 30:
        parser.error("Promotion batch must contain 1 to 30 symbols")
    with closing(SupabaseRestClient(Settings.from_env())) as client:
        if args.promote is not None:
            promote(client, args.promote)
        else:
            run(client, args.shard, args.shards)
