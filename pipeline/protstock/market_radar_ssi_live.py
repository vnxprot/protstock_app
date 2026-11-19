"""Capture SSI WebSocket trades and publish compact live Radar snapshots."""
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
from .market_radar import EXCHANGES
from .market_radar_ssi import SYMBOLS, ssi_config, trade_record
from .market_radar_tape import Match, phase
from .market_sources import VN
from .research_archive import check_storage_budget
from .supabase_rest import SupabaseRestClient

LIVE_BUCKET = "market-radar-live"
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
    response.raise_for_status()
    if response.json().get("public") is not False:
        raise ValueError("Radar snapshot bucket must be private")


def publish_snapshot(client, conn, now, watched):
    markets = {exchange: value for exchange, value in snapshot(conn, now, watched).items() if value["rows"]}
    files = {exchange: gzip.compress(json.dumps(value, separators=(",", ":")).encode(), mtime=0)
             for exchange, value in markets.items()}
    if any(len(content) >= MAX_SNAPSHOT_BYTES for content in files.values()):
        raise ValueError("Radar snapshot exceeds budget")
    if not files:
        print("SSI live: waiting for the first trade", flush=True)
        return False
    check_storage_budget(client, sum(map(len, files.values())))
    for exchange, content in files.items():
        client.post(f"/storage/v1/object/{LIVE_BUCKET}/{exchange}.json.gz", content=content,
                    headers={"x-upsert": "true", "Content-Type": "application/gzip", "Cache-Control": "max-age=30"}).raise_for_status()
    coverage = ", ".join(f"{exchange}: {len(value['rows'])} mã" for exchange, value in markets.items())
    print(f"SSI live snapshot published at {now:%H:%M:%S} Vietnam time ({coverage})", flush=True)
    return True


def subscribe_trades(stream, symbols):
    names = list(symbols)
    for offset in range(0, len(names), 45):
        stream.subscribe_symbol_trade(names[offset:offset + 45])
    topics = {str(topic).casefold() for topic in stream.list_subscription(timeout_ms=10_000)["data"]}
    confirmed = sum(f"trade.{symbol}".casefold() in topics or f"trade.{symbol}@tick".casefold() in topics
                    for symbol in names)
    if not confirmed:
        raise RuntimeError("SSI did not confirm any per-symbol trade subscriptions")
    print(f"SSI confirmed {confirmed}/{len(names)} trade subscriptions", flush=True)


def capture(directory, client, symbols, watched, day, publish, *, morning=False):
    from ssi_sdk import Auth, Stream
    from ssi_sdk.models.streaming import TradeMessage

    end = datetime.combine(day, time(11, 35) if morning else time(15, 15), VN)
    queue = Queue(maxsize=50_000)
    lost = Event()

    def on_data(message):
        if not isinstance(message, TradeMessage) or message.symbol not in symbols:
            return
        if message.quantity in (None, 0, "0"):
            return
        try:
            match = trade_record(message, day)
        except (ValueError, TypeError):
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
            subscribe_trades(stream.streaming, symbols)
            print(f"SSI WebSocket capture started for {len(symbols)} symbols through {end:%H:%M}", flush=True)
            next_snapshot = monotonic() + 20
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
                    published = False
                    try:
                        published = publish_snapshot(client, conn, datetime.now(VN), watched)
                    except httpx.HTTPStatusError as error:
                        print(f"Live publication deferred: Storage HTTP {error.response.status_code}", flush=True)
                    except (httpx.HTTPError, RuntimeError, ValueError) as error:
                        print(f"Live publication deferred: {type(error).__name__}", flush=True)
                    next_snapshot = monotonic() + (15 * 60 if published else 60)
        remaining = []
        while not queue.empty():
            remaining.append(queue.get_nowait())
        if remaining:
            record(conn, symbols, remaining)
        covered = conn.execute("select count(distinct symbol) from ticks").fetchone()[0]
        print(f"SSI tape has trades for {covered}/{len(symbols)} symbols", flush=True)
        if lost.is_set():
            with conn:
                conn.execute("insert or ignore into gaps values(?)", (int(end.timestamp()),))
        if publish:
            try:
                publish_snapshot(client, conn, datetime.now(VN), watched)
            except (httpx.HTTPError, RuntimeError, ValueError) as error:
                print(f"Final live snapshot deferred: {type(error).__name__}", flush=True)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--universe", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--morning", action="store_true", help="Stop at the lunch break for runner handoff")
    parser.add_argument("--check-startup", action="store_true", help="Check Storage and SSI connection outside market hours")
    parser.add_argument("--watch", default=",".join(SYMBOLS))
    args = parser.parse_args()
    watched = {symbol.strip().upper() for symbol in args.watch.split(",") if symbol.strip()}
    if len(watched) > 24:
        parser.error("Use at most 24 published minute charts")
    if args.publish and os.getenv("RADAR_SSI_APPROVED") != "true":
        parser.error("Confirm SSI data use and the pilot before enabling publication")
    stage = "configuration"
    try:
        with ExitStack() as stack:
            db = client = None
            if args.universe or args.publish:
                settings = Settings.from_env()
                db = stack.enter_context(closing(SupabaseRestClient(settings)))
                if args.publish:
                    client = stack.enter_context(storage_client(settings))
            now = datetime.now(VN)
            cutoff = time(11, 35) if args.morning else time(15, 15)
            if not args.check_startup and (now.weekday() > 4 or not time(8, 40) <= now.time() < cutoff):
                print("SSI streaming is outside the capture window", flush=True)
                return
            prune_local_tapes(args.directory, now.date())
            stage = "Supabase universe"
            symbols = {row["symbol"]: row["exchange"] for row in db.active_symbols() if row["exchange"] in EXCHANGES} if args.universe else SYMBOLS
            if args.publish:
                stage = "Supabase live bucket"
                ensure_bucket(client)
            stage = "SSI WebSocket"
            if args.check_startup:
                from ssi_sdk import Auth, Stream
                with Auth(ssi_config()) as auth:
                    auth.authenticate()
                    with Stream(auth) as stream:
                        stream.streaming.connect()
                        subscribe_trades(stream.streaming, ["HDB"])
                print("SSI live startup check completed", flush=True)
                return
            capture(args.directory, client, symbols, watched, now.date(), args.publish, morning=args.morning)
    except httpx.HTTPStatusError as error:
        raise SystemExit(f"Radar startup {stage}: HTTP {error.response.status_code}") from None
    except Exception as error:
        raise SystemExit(f"Radar startup {stage}: {type(error).__name__}") from None


if __name__ == "__main__":
    main()
