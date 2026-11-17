"""Capture SSI market trades locally, publish bounded snapshots, and finalize closed sessions."""
from argparse import ArgumentParser
from contextlib import closing, ExitStack
from dataclasses import replace
from datetime import date, datetime, time, timedelta
import gzip
import json
import os
from pathlib import Path
from queue import Empty, Full, Queue
import sqlite3
from threading import Event
from time import monotonic

import httpx

from .config import Settings
from .market_radar import (EXCHANGES, capture_matches, reconcile_tape, session_dates,
                           storage_used)
from .market_radar_ssi import SYMBOLS, closed_reference, ssi_config, trade_record
from .market_radar_tape import Match, phase
from .market_sources import VN
from .research_archive import check_storage_budget
from .supabase_rest import SupabaseRestClient

LIVE_BUCKET = "market-radar-live"
LIVE_LIMIT = 400_000_000
EOD_LIMIT = 440_000_000
MAX_SNAPSHOT_BYTES = 512_000
LOCAL_DAYS = 7


def tape_path(directory, day):
    return directory / f"ssi-radar-{day}.sqlite3"


def prune_local_tapes(directory, today):
    for path in directory.glob("ssi-radar-????-??-??.sqlite3"):
        try:
            day = date.fromisoformat(path.stem.removeprefix("ssi-radar-"))
        except ValueError:
            continue
        if day < today - timedelta(days=LOCAL_DAYS) and path.is_file() and not path.is_symlink():
            path.unlink()


def open_tape(directory, day):
    directory.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(tape_path(directory, day))
    conn.executescript("""
        create table if not exists symbols(symbol text primary key, exchange text not null);
        create table if not exists ticks(symbol text, cumulative integer, stamp integer, price integer,
            quantity integer, side text, phase text, size text, primary key(symbol,cumulative)) without rowid;
        create table if not exists invalid(symbol text primary key);
        create table if not exists gaps(stamp integer primary key);
        create table if not exists minute(symbol text, minute integer, size text, buys integer, sells integer,
            buy_qty integer, sell_qty integer, trades integer, primary key(symbol,minute,size)) without rowid;
        create trigger if not exists tick_minute after insert on ticks when new.phase='continuous' begin
            insert into minute values (new.symbol,new.stamp/60*60,new.size,
                case when new.side='b' then new.price*new.quantity else 0 end,
                case when new.side='s' then new.price*new.quantity else 0 end,
                case when new.side='b' then new.quantity else 0 end,
                case when new.side='s' then new.quantity else 0 end,1)
            on conflict(symbol,minute,size) do update set buys=buys+excluded.buys,sells=sells+excluded.sells,
                buy_qty=buy_qty+excluded.buy_qty,sell_qty=sell_qty+excluded.sell_qty,trades=trades+1;
        end;
        create trigger if not exists conflicting_tick before insert on ticks
            when exists(select 1 from ticks t where t.symbol=new.symbol and t.cumulative=new.cumulative
                and (t.stamp<>new.stamp or t.price<>new.price or t.quantity<>new.quantity or t.side<>new.side))
            begin insert or ignore into invalid values(new.symbol); end;
    """)
    return conn


def record(conn, symbols, items):
    rows, invalid = [], []
    for symbol, match in items:
        if match is None:
            invalid.append((symbol,))
            continue
        exchange = symbols[symbol]
        if exchange == "HOSE" and time(9) <= match.stamp.time() <= time(9, 15):
            match = replace(match, side="ato")
        value = match.price * match.volume
        size = "large" if value >= 1_000_000_000 else "medium" if value >= 200_000_000 else "small"
        rows.append((symbol, match.cumulative, int(match.stamp.timestamp()), match.price, match.volume,
                     match.side, phase(exchange, match), size))
    with conn:
        conn.executemany("insert or ignore into invalid values(?)", invalid)
        conn.executemany("insert or ignore into ticks values(?,?,?,?,?,?,?,?)", rows)


def snapshot(conn, now, watched):
    exchanges = {exchange: {"day": str(now.date()), "updated_at": now.isoformat(), "last_tick": None, "rows": []} for exchange in EXCHANGES}
    totals = {}
    for symbol, size, b, s, bq, sq, count in conn.execute("""select symbol,size,sum(buys),sum(sells),
            sum(buy_qty),sum(sell_qty),sum(trades) from minute group by symbol,size"""):
        totals.setdefault(symbol, {})[size] = [b, s, bq, sq, count]
    invalid = {row[0] for row in conn.execute("select symbol from invalid")}
    has_gaps = conn.execute("select 1 from gaps limit 1").fetchone() is not None
    volumes = dict(conn.execute("select symbol,sum(quantity) from ticks group by symbol"))
    for symbol, exchange in conn.execute("select symbol,exchange from symbols order by symbol"):
        last = conn.execute("select price,cumulative,stamp from ticks where symbol=? order by cumulative desc limit 1", (symbol,)).fetchone()
        if not last:
            continue
        market = exchanges[exchange]
        market["last_tick"] = max(market["last_tick"] or 0, last[2])
        data = {"symbol": symbol, "price": last[0], "partial": symbol in invalid or volumes[symbol] != last[1] or has_gaps,
                "groups": totals.get(symbol, {})}
        if symbol in watched:
            data["minutes"] = list(conn.execute("select minute,size,buys-sells,buy_qty-sell_qty from minute where symbol=? order by minute", (symbol,)))
        market["rows"].append(data)
    return exchanges


def storage_client(settings):
    headers = {"apikey": settings.service_role_key, "Authorization": f"Bearer {settings.service_role_key}"}
    return httpx.Client(base_url=settings.supabase_url, headers=headers, timeout=20)


def ensure_bucket(client):
    response = client.get(f"/storage/v1/bucket/{LIVE_BUCKET}")
    if response.status_code == 404:
        client.post("/storage/v1/bucket", json={"id": LIVE_BUCKET, "name": LIVE_BUCKET, "public": False,
            "file_size_limit": MAX_SNAPSHOT_BYTES, "allowed_mime_types": ["application/gzip"]}).raise_for_status()
        return
    response.raise_for_status()
    if response.json().get("public") is not False:
        raise ValueError("Radar snapshot bucket must be private")


def publish_snapshot(db, client, conn, now, watched):
    if storage_used(db) >= LIVE_LIMIT:
        return False
    files = {exchange: gzip.compress(json.dumps(value, separators=(",", ":")).encode(), mtime=0)
             for exchange, value in snapshot(conn, now, watched).items() if value["rows"]}
    if any(len(content) >= MAX_SNAPSHOT_BYTES for content in files.values()):
        raise ValueError("Radar snapshot exceeds budget")
    if not files:
        return True
    check_storage_budget(client, sum(map(len, files.values())))
    for exchange, content in files.items():
        client.post(f"/storage/v1/object/{LIVE_BUCKET}/{exchange}.json.gz", content=content,
                    headers={"x-upsert": "true", "Content-Type": "application/gzip", "Cache-Control": "max-age=30"}).raise_for_status()
    return True


def captured_trades(conn, symbol):
    return [Match(datetime.fromtimestamp(stamp, VN), price, quantity, cumulative, side) for
            stamp, price, quantity, cumulative, side in conn.execute("""select stamp,price,quantity,cumulative,side
            from ticks where symbol=? order by stamp,cumulative""", (symbol,))]


def stage_close(db, client, conn, day):
    if storage_used(db) >= LIVE_LIMIT or conn.execute("select 1 from gaps limit 1").fetchone():
        return
    captures = {}
    invalid = {row[0] for row in conn.execute("select symbol from invalid")}
    for symbol, exchange in conn.execute("select symbol,exchange from symbols"):
        if symbol in invalid:
            continue
        tape = captured_trades(conn, symbol)
        summary = capture_matches(tape, exchange)
        if not summary['reason'] and summary['volume']:
            captures[symbol] = summary
    if not captures:
        return
    content = gzip.compress(json.dumps({"day": day.isoformat(), "symbols": captures}, separators=(",", ":")).encode(), mtime=0)
    if len(content) >= MAX_SNAPSHOT_BYTES:
        raise ValueError("SSI closing candidate exceeds budget")
    check_storage_budget(client, len(content))
    client.post(f"/storage/v1/object/{LIVE_BUCKET}/closing.json.gz", content=content,
                headers={"x-upsert": "true", "Content-Type": "application/gzip", "Cache-Control": "no-cache"}).raise_for_status()
    print(f"SSI closing candidate staged: {day} · {len(captures)} symbols", flush=True)


def capture(directory, db, client, symbols, watched, day, publish):
    from ssi_sdk import Auth, Stream
    from ssi_sdk.models.streaming import TradeMessage

    end = datetime.combine(day, time(15, 15), VN)
    queue = Queue(maxsize=50_000)
    lost = Event()

    def on_data(message):
        if not isinstance(message, TradeMessage) or message.symbol not in symbols:
            return
        if message.quantity in (None, 0, "0"):
            return
        try:
            match = trade_record(message)
        except ValueError:
            match = None
        if match is not None and match.stamp.date() != day:
            return
        try:
            queue.put_nowait((message.symbol, match))
        except Full:
            lost.set()

    with closing(open_tape(directory, day)) as conn, Auth(ssi_config()) as auth:
        with conn:
            conn.executemany("insert or ignore into symbols values(?,?)", symbols.items())
        auth.authenticate()
        with Stream(auth) as stream:
            stream.streaming.on_data = on_data
            stream.streaming.connect()
            for offset in range(0, len(symbols), 45):
                stream.streaming.subscribe_symbol_trade(list(symbols)[offset:offset + 45])
            next_snapshot = monotonic() + 60
            while datetime.now(VN) < end:
                batch = []
                try:
                    batch.append(queue.get(timeout=1))
                    while len(batch) < 5000:
                        batch.append(queue.get_nowait())
                except Empty:
                    pass
                if batch:
                    record(conn, symbols, batch)
                if lost.is_set():
                    with conn:
                        conn.execute("insert or ignore into gaps values(?)", (int(datetime.now(VN).timestamp()),))
                    lost.clear()
                if publish and monotonic() >= next_snapshot:
                    try:
                        if not publish_snapshot(db, client, conn, datetime.now(VN), watched):
                            print("Live publication deferred: PostgreSQL is at or above 400 MB", flush=True)
                    except (httpx.HTTPError, RuntimeError, ValueError) as error:
                        print(f"Live publication deferred: {type(error).__name__}", flush=True)
                    next_snapshot = monotonic() + 60
        remaining = []
        while not queue.empty():
            remaining.append(queue.get_nowait())
        if remaining:
            record(conn, symbols, remaining)
        if lost.is_set():
            with conn:
                conn.execute("insert or ignore into gaps values(?)", (int(end.timestamp()),))
        if publish:
            try:
                stage_close(db, client, conn, day)
                publish_snapshot(db, client, conn, datetime.now(VN), watched)
            except (httpx.HTTPError, RuntimeError, ValueError) as error:
                print(f"Final live snapshot deferred: {type(error).__name__}", flush=True)


def finalize(directory, db, day):
    from ssi_sdk import Auth, Data

    if storage_used(db) >= EOD_LIMIT:
        print("SSI end-of-day publication deferred: PostgreSQL is at or above 440 MB", flush=True)
        return
    now = datetime.now(VN)
    closed = now.date() if now.time() >= time(16, 30) else now.date() - timedelta(days=1)
    if day not in session_dates(db, closed, 20):
        raise ValueError("Expected a closed session in the retained 20-session calendar")
    if not tape_path(directory, day).is_file():
        raise ValueError("No local SSI tape for this date")
    with closing(open_tape(directory, day)) as conn, Auth(ssi_config()) as auth:
        if conn.execute("select 1 from gaps limit 1").fetchone():
            raise ValueError("Local buffer lost events; keep the session for recovery")
        auth.authenticate()
        data = Data(auth)
        verified = count = 0
        for symbol, exchange in conn.execute("select symbol,exchange from symbols order by symbol"):
            count += 1
            if conn.execute("select 1 from invalid where symbol=?", (symbol,)).fetchone():
                continue
            ref = closed_reference(data, day, symbol)
            if ref is None:
                continue
            tape = captured_trades(conn, symbol)
            rows = reconcile_tape(day, exchange, symbol, capture_matches(tape, exchange), tape_source="SSI WebSocket",
                                  reference_pair=(ref.total_match, "SSI FastConnect EOD"))
            if rows[0]["partial"]:
                print(f"{day} {symbol}: {rows[0]['tape_reason']}", flush=True)
                continue
            db._request("POST", "/rpc/publish_market_radar_tape", json={"p_rows": rows}).raise_for_status()
            verified += 1
        print(f"SSI end-of-day {day}: {verified}/{count} symbols reconciled", flush=True)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--universe", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--watch", default=",".join(SYMBOLS))
    parser.add_argument("--finalize", type=date.fromisoformat)
    args = parser.parse_args()
    watched = {symbol.strip().upper() for symbol in args.watch.split(",") if symbol.strip()}
    if len(watched) > 24:
        parser.error("Use at most 24 published minute charts")
    if (args.publish or args.finalize) and os.getenv("RADAR_SSI_APPROVED") != "true":
        parser.error("Confirm SSI data use and the pilot before enabling publication")
    try:
        with ExitStack() as stack:
            db = client = None
            if args.universe or args.publish or args.finalize:
                settings = Settings.from_env()
                db = stack.enter_context(closing(SupabaseRestClient(settings)))
                if args.publish:
                    client = stack.enter_context(storage_client(settings))
            if args.finalize:
                finalize(args.directory, db, args.finalize)
                return
            now = datetime.now(VN)
            if now.weekday() > 4 or not time(8, 40) <= now.time() < time(15, 15):
                return
            prune_local_tapes(args.directory, now.date())
            symbols = {row["symbol"]: row["exchange"] for row in db.active_symbols() if row["exchange"] in EXCHANGES} if args.universe else SYMBOLS
            if args.publish and storage_used(db) < LIVE_LIMIT:
                ensure_bucket(client)
            capture(args.directory, db, client, symbols, watched, now.date(), args.publish)
    except Exception as error:
        raise SystemExit(f"SSI recorder stopped: {type(error).__name__}") from None


if __name__ == "__main__":
    main()
