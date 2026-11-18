"""Stage SSI history without growing the production PostgreSQL price tables."""
from argparse import ArgumentParser
from contextlib import closing
from datetime import date, datetime, timedelta
from decimal import Decimal
import gzip
from hashlib import sha256
import json

import httpx

from .config import Settings
from .market_radar_tape import integer
from .market_sources import VN
from .models import DailyBar
from .provider_market import MarketDataProvider
from .research_archive import BUCKET, STORAGE_BUDGET
from .ssi_market_data import market_data
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

    if storage_used(db) >= 390_000_000:
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


def run(db, shard, shards):
    index = db.market_index("VNINDEX")
    today = datetime.now(VN).date()
    days = sorted(db.index_price_dates(index["id"], FLOW_START, today))[-50:]
    if not days:
        raise RuntimeError("No published sessions for SSI staging")
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
            # Endpoint/download exceptions can contain signed URLs.
            print(f"::warning::{symbol} SSI history deferred: {type(error).__name__}", flush=True)
    if not staged:
        raise RuntimeError("No SSI history staged in this shard")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--shard", type=int, required=True)
    parser.add_argument("--shards", type=int, required=True)
    args = parser.parse_args()
    if not 0 <= args.shard < args.shards:
        parser.error("Invalid shard")
    with closing(SupabaseRestClient(Settings.from_env())) as client:
        run(client, args.shard, args.shards)
