"""Restore Vietcap where necessary and move verified older prices to Storage."""
from hashlib import sha256
import gzip
import json
import os

import httpx
import psycopg
from psycopg.types.json import Jsonb

from protstock.config import Settings
from protstock.eod import HISTORY_START
from protstock.price_archive import archive_prices, read_prices, remove_previous
from protstock.price_basis import canonical_price_rows
from protstock.provider_market import MarketDataProvider, ProviderDataError
from protstock.research_archive import BUCKET

HOT_SESSIONS = 400


def sql_prices(conn, symbol_id):
    return [row[0] for row in conn.execute(
        "select to_jsonb(p) from public.daily_prices p where symbol_id=%s order by trading_date", (symbol_id,)
    )]


def restore_vci(conn, storage, provider, symbol, symbol_id, rows, end):
    if not any(row["source"].startswith("SSI_") for row in rows):
        return rows, False
    bars = provider.history(symbol, HISTORY_START, end)
    restored = canonical_price_rows(symbol_id, bars, [], as_of_date=end)
    if not restored or restored[-1]["trading_date"] < rows[-1]["trading_date"]:
        raise ProviderDataError("Vietcap has yet to supply the latest stored session")
    vci_rows = {row["trading_date"]: row for row in restored}
    missing = {row["trading_date"] for row in rows if row["source"].startswith("SSI_")} - vci_rows.keys()
    if missing:
        prefix = f"ssi-cutover/daily_prices/{symbol_id}/"
        for (name,) in conn.execute("""select name from storage.objects
            where bucket_id=%s and name like %s order by created_at desc""", (BUCKET, prefix + "%")):
            response = storage.get(f"/storage/v1/object/authenticated/{BUCKET}/{name}")
            response.raise_for_status()
            if name != prefix + sha256(response.content).hexdigest() + ".json.gz":
                raise RuntimeError("Vietcap rollback archive checksum mismatch")
            original = {row["trading_date"]: row for row in json.loads(gzip.decompress(response.content))
                        if row["source"] == "VCI_DIRECT" and row["quality_status"] == "VALID"}
            overlap = original.keys() & vci_rows.keys()
            if overlap and all(
                abs(float(original[day][field]) - float(vci_rows[day][field])) <= 0.005
                and original[day]["data_revision"] == vci_rows[day]["data_revision"]
                for day in overlap for field in ("open", "high", "low", "close")
            ):
                vci_rows.update((day, original[day]) for day in missing & original.keys())
                missing -= original.keys()
            if not missing:
                break
    if missing:
        raise ProviderDataError(f"Vietcap missing {len(missing)} sessions, first {min(missing)}")
    previous = {row["trading_date"]: row for row in rows}
    previous.update(vci_rows)
    return [previous[day] for day in sorted(previous)], True


def maintain_symbol(conn, storage, provider, symbol_id, symbol, cutoff, end):
    manifest = conn.execute("select checksum from public.daily_price_archives where symbol_id=%s", (symbol_id,)).fetchone()
    old = manifest[0] if manifest else None
    archived = read_prices(storage, symbol_id, old) if old else []
    before = sql_prices(conn, symbol_id)
    if not before:
        return 0, False
    rows = {row["trading_date"]: row for row in archived}
    rows.update((row["trading_date"], row) for row in before)
    rows, restored = restore_vci(conn, storage, provider, symbol, symbol_id, [rows[day] for day in sorted(rows)], end)
    cold = [row for row in rows if row["trading_date"] < cutoff]
    if not restored and not any(row["trading_date"] < cutoff for row in before):
        return 0, False
    checksum = archive_prices(storage, symbol_id, cold, old) if cold else None
    with conn.transaction():
        conn.execute("set local lock_timeout = '8s'")
        conn.execute("lock table public.daily_prices in share row exclusive mode")
        current = conn.execute("select checksum from public.daily_price_archives where symbol_id=%s for update", (symbol_id,)).fetchone()
        if current != manifest or sql_prices(conn, symbol_id) != before:
            raise RuntimeError("Price history changed during archival")
        if checksum:
            conn.execute("""insert into public.daily_price_archives (symbol_id,first_day,last_day,checksum)
                values (%s,%s,%s,%s) on conflict (symbol_id) do update set
                first_day=excluded.first_day,last_day=excluded.last_day,checksum=excluded.checksum""",
                (symbol_id, cold[0]["trading_date"], cold[-1]["trading_date"], checksum))
        removed = conn.execute("delete from public.daily_prices where symbol_id=%s and trading_date<%s", (symbol_id, cutoff)).rowcount
        if restored:
            hot = [row for row in rows if row["trading_date"] >= cutoff and row["source"] == "VCI_DIRECT"
                   and row["trading_date"] >= HISTORY_START.isoformat()]
            conn.execute("""insert into public.daily_prices (symbol_id,trading_date,open,high,low,close,volume,
                source_volume,volume_adjustment_factor,volume_basis,price_basis,source,source_version,price_unit,
                collected_at,quality_status,data_revision)
                select symbol_id,trading_date,open,high,low,close,volume,source_volume,volume_adjustment_factor,
                       volume_basis,price_basis,source,source_version,price_unit,collected_at,quality_status,data_revision
                from jsonb_populate_recordset(null::public.daily_prices,%s)
                on conflict (symbol_id,trading_date) do update set open=excluded.open,high=excluded.high,low=excluded.low,
                close=excluded.close,volume=excluded.volume,source_volume=excluded.source_volume,
                volume_adjustment_factor=excluded.volume_adjustment_factor,volume_basis=excluded.volume_basis,
                price_basis=excluded.price_basis,source=excluded.source,source_version=excluded.source_version,
                price_unit=excluded.price_unit,collected_at=excluded.collected_at,quality_status=excluded.quality_status,
                data_revision=excluded.data_revision,raw_payload=null,source_url=null,adjusted_close=null,
                adjustment_factor=1,traded_value=null""", (Jsonb(hot),))
    remove_previous(storage, symbol_id, old, checksum)
    return removed, restored


def compact(conn, original_size, original_rows):
    conn.execute("vacuum (analyze) public.daily_prices")
    current = conn.execute("select pg_database_size(current_database())").fetchone()[0]
    remaining = conn.execute("select count(*) from public.daily_prices").fetchone()[0]
    estimated_rewrite = original_size * remaining // max(original_rows, 1)
    if remaining < original_rows and current + estimated_rewrite < 495_000_000:
        conn.execute("set lock_timeout = '8s'")
        try:
            conn.execute("vacuum full public.daily_prices")
        except psycopg.errors.LockNotAvailable:
            print("::warning::Price compaction deferred: the table is busy")
    elif remaining < original_rows:
        print("::warning::Physical price compaction deferred until the database has enough rewrite space")
    size = conn.execute("select pg_database_size(current_database())").fetchone()[0]
    print(f"PostgreSQL: {size:,} bytes, {remaining:,} OHLCV rows retained in SQL", flush=True)


def run():
    settings = Settings.from_env()
    headers = {"apikey": settings.service_role_key, "Authorization": f"Bearer {settings.service_role_key}"}
    provider = MarketDataProvider("VCI")
    with psycopg.connect(os.environ["SUPABASE_DB_URL"], autocommit=True) as conn, httpx.Client(
        base_url=settings.supabase_url, headers=headers, timeout=90,
    ) as storage:
        calendar = conn.execute("""
            select p.trading_date from public.market_index_prices p join public.market_indices i on i.id=p.index_id
            where i.code='VNINDEX' order by p.trading_date desc limit %s
        """, (HOT_SESSIONS,)).fetchall()
        if not calendar:
            raise RuntimeError("VNINDEX calendar unavailable")
        cutoff, end = calendar[-1][0].isoformat(), calendar[0][0]
        # Older personal records still use SQL prices for historical valuation and journal baselines.
        symbols = conn.execute("""select s.id,s.symbol,
          least(%s::date,
            (select min(trading_date)-30 from public.portfolio_transactions where symbol_id=s.id),
            (select min(decision_date)-30 from public.journal_entries where symbol_id=s.id))
          from public.symbols s where s.active order by s.symbol""", (cutoff,)).fetchall()
        with conn.transaction():
            conn.execute("set local lock_timeout = '8s'")
            conn.execute("lock table public.derived_bars in access exclusive mode")
            if not conn.execute("select exists (select 1 from public.derived_bars)").fetchone()[0]:
                conn.execute("truncate public.derived_bars restrict")
        original_size, original_rows = conn.execute(
            "select pg_total_relation_size('public.daily_prices'),count(*) from public.daily_prices"
        ).fetchone()
        failures = []
        for symbol_id, symbol, retain_from in symbols:
            try:
                removed, restored = maintain_symbol(conn, storage, provider, symbol_id, symbol, retain_from.isoformat(), end)
                if removed or restored:
                    print(f"{symbol}: archived {removed} SQL rows; Vietcap restored={restored}", flush=True)
            except (ProviderDataError, RuntimeError, psycopg.Error, httpx.HTTPError) as error:
                detail = str(error) if isinstance(error, (ProviderDataError, RuntimeError)) else type(error).__name__
                print(f"::warning::{symbol}: {detail}", flush=True)
                failures.append(symbol)
        compact(conn, original_size, original_rows)
        if failures:
            raise RuntimeError("OHLCV maintenance deferred for " + ",".join(failures))


if __name__ == "__main__":
    run()
