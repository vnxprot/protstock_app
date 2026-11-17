"""Archive superseded screening data before reclaiming production database space.

Run only from the manual database-capacity workflow. The archive is verified by
downloading it from the private Storage bucket before any database row is removed.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from protstock.research_archive import ResearchArchive, check_storage_budget


PROJECT_URL = "https://upmqxwktvvguegqeqibn.supabase.co"
BUCKET = "database-archives"
LIVE_FUNNEL = "MTF_FUNNEL_SHADOW_V0_0_0_TREND1"
LIVE_MACD = "MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0"
LIVE_ZONES = "core-rules-v0.0.0-trend1"
LIVE_CHALLENGER = "v0.0.0-challenger-trend1"
RESEARCH_RETENTION_DAYS = 400
ASSESSMENT_RETENTION_DAYS = 180
DATABASE_TARGET = 400_000_000
RADAR_START_LIMIT = 440_000_000
ANALYSIS_ARCHIVES = (
    ("challenger_strategy_assessments", "trading_date", ("symbol_id", "engine_version", "strategy_code"),
     "not exists (select 1 from public.challenger_strategy_tplus_outcomes o where o.symbol_id=t.symbol_id and o.signal_date=t.trading_date and o.engine_version=t.engine_version and o.strategy_code=t.strategy_code)"),
    ("challenger_signal_assessments", "trading_date", ("id",), "true"),
    ("support_resistance_zones", "as_of_date", ("id",), "true"),
    ("pattern_instances", "as_of_date", ("id",), "true"),
    ("momentum_radar_assessments", "as_of_date", ("symbol_id", "version"), "true"),
    ("signal_funnel_assessments", "as_of_date", ("symbol_id", "version"), "true"),
)
ARCHIVES = (
    ("research_price_bars", "public.research_price_bars", "true"),
    ("research_price_sync_status", "public.research_price_sync_status", "true"),
    ("legacy_funnel", "public.signal_funnel_assessments", "version <> 'MTF_FUNNEL_SHADOW_V0_0_0_TREND1'"),
    ("legacy_macd", "public.macd_divergence_assessments", "version <> 'MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0'"),
    ("legacy_zones", "public.support_resistance_zones", "algorithm_version <> 'core-rules-v0.0.0-trend1'"),
    ("legacy_challenger_strategies", "public.challenger_strategy_assessments",
     "engine_version <> 'v0.0.0-challenger-trend1' and not exists (select 1 from public.challenger_strategy_tplus_outcomes o where o.symbol_id=t.symbol_id and o.signal_date=t.trading_date and o.engine_version=t.engine_version and o.strategy_code=t.strategy_code)"),
    ("cold_challenger_strategies", "public.challenger_strategy_assessments",
     "engine_version = 'v0.0.0-challenger-trend1' and trading_date < date '{assessment_cutoff}' and action='WATCH' and not exists (select 1 from public.challenger_strategy_tplus_outcomes o where o.symbol_id=t.symbol_id and o.signal_date=t.trading_date and o.engine_version=t.engine_version and o.strategy_code=t.strategy_code)"),
)


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def storage_request(client: httpx.Client, method: str, path: str, **kwargs) -> httpx.Response:
    response = client.request(method, path, **kwargs)
    response.raise_for_status()
    return response


def ensure_private_bucket(client: httpx.Client) -> None:
    response = client.get(f"/storage/v1/bucket/{BUCKET}")
    if response.status_code == 404:
        storage_request(client, "POST", "/storage/v1/bucket", json={"id": BUCKET, "name": BUCKET, "public": False})
        return
    response.raise_for_status()
    if response.json().get("public") is not False:
        raise RuntimeError("Archive bucket must be private")


def archive_table(conn: psycopg.Connection, directory: Path, name: str, table: str, predicate: str) -> dict:
    target = directory / f"{name}.csv.gz"
    with conn.cursor() as cursor:
        cursor.execute(f"select count(*), coalesce(sum(hashtextextended(row_to_json(t)::text,0)::numeric),0)::text from {table} t where {predicate}")
        count, fingerprint = cursor.fetchone()
        with gzip.open(target, "wb", compresslevel=9) as compressed:
            with cursor.copy(f"copy (select * from {table} t where {predicate}) to stdout with (format csv, header true)") as copy:
                for block in copy:
                    compressed.write(block)
    return {"name": name, "table": table, "predicate": predicate, "rows": count, "fingerprint": fingerprint,
            "bytes": target.stat().st_size, "sha256": digest(target), "filename": target.name}


def upload_verified(client: httpx.Client, key: str, content: bytes, *, reuse=False, content_type="application/gzip") -> None:
    if reuse:
        current = client.get(f"/storage/v1/object/authenticated/{BUCKET}/{key}")
        if current.is_success:
            if current.content != content:
                raise RuntimeError(f"Archive verification failed: {key}")
            return
        if current.status_code not in {400, 404}:
            current.raise_for_status()
    check_storage_budget(client, len(content))
    storage_request(client, "POST", f"/storage/v1/object/{BUCKET}/{key}",
                    content=content, headers={"Content-Type": content_type, "x-upsert": "false"})
    remote = storage_request(client, "GET", f"/storage/v1/object/authenticated/{BUCKET}/{key}").content
    if hashlib.sha256(remote).digest() != hashlib.sha256(content).digest():
        raise RuntimeError(f"Archive verification failed: {key}")


def database_bytes(conn):
    return conn.execute("select pg_database_size(current_database())").fetchone()[0]


def report_capacity(conn):
    print(f"PostgreSQL: {database_bytes(conn):,} bytes; Storage: {conn.execute('select public.protstock_storage_bytes()').fetchone()[0]:,} bytes", flush=True)
    for row in conn.execute("""select schemaname, relname, pg_table_size(relid), pg_indexes_size(relid), n_live_tup, n_dead_tup
            from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 20"""):
        print("Relation (schema, table, data and TOAST bytes, index bytes, live rows, dead rows):", row, flush=True)


def archive_analysis(conn, storage, *, measure=False, retry_vacuum=False):
    cutoff = conn.execute("""select min(ip.trading_date) from (
        select p.trading_date from public.market_index_prices p join public.market_indices i on i.id=p.index_id
        where i.code='VNINDEX' and p.trading_date <= (now() at time zone 'Asia/Ho_Chi_Minh')::date
        order by p.trading_date desc limit 20) ip
        having count(*)=20""").fetchone()
    if cutoff is None:
        print("No complete 20-session calendar for analysis retention", flush=True)
        return 0
    total = 0
    for table, day_column, identity, protected_scope in ANALYSIS_ARCHIVES:
        key = f"concat_ws(':', {', '.join('t.' + column for column in identity)})"
        scope = f"t.evidence <> '{{}}'::jsonb and not (t.evidence ? '_historyObject') and ({protected_scope})"
        dates = conn.execute(f"""select distinct t.{day_column} from public.{table} t
            where t.{day_column} < %s and {scope} order by 1""", cutoff).fetchall()
        select = f"""select count(*), coalesce(jsonb_object_agg({key}, jsonb_build_object('evidence', t.evidence)), '{{}}'::jsonb)::text
            from public.{table} t
            where t.{day_column} = %s and {scope}"""
        rows = compressed = raw = 0
        for (day,) in dates:
            count, payloads = conn.execute(select, (day,)).fetchone()
            if not count:
                continue
            data = payloads.encode()
            content = gzip.compress(data, compresslevel=6, mtime=0)
            raw += len(data)
            compressed += len(content)
            rows += count
            if measure:
                continue
            if len(content) >= 45_000_000:
                raise RuntimeError(f"Analysis archive must be split: {table} {day}")
            object_key = f"analysis/v1/{table}/{day}/{hashlib.sha256(content).hexdigest()}.json.gz"
            upload_verified(storage, object_key, content, reuse=True)
            with conn.transaction():
                conn.execute("set local lock_timeout = '8s'")
                conn.execute(f"lock table public.{table} in share row exclusive mode")
                if conn.execute(select, (day,)).fetchone() != (count, payloads):
                    raise RuntimeError(f"Analysis changed after upload: {table} {day}; rerun to compact")
                # Keep the monthly state read by the historical Opportunities SQL.
                keep = "jsonb_strip_nulls(jsonb_build_object('monthly_state', t.evidence->'monthly_state')) ||" if table == "momentum_radar_assessments" else ""
                changed = conn.execute(f"""update public.{table} t set evidence = {keep}
                    jsonb_build_object('_historyObject', %s::text, '_historyKey', {key})
                    where t.{day_column} = %s and {scope}""", (object_key, day))
                if changed.rowcount != count:
                    raise RuntimeError(f"Analysis row count changed: {table} {day}")
        print(f"{table}: {rows:,} rows, {raw:,} raw JSON bytes, {compressed:,} compressed bytes", flush=True)
        total += compressed
        if not measure and (rows or (retry_vacuum and database_bytes(conn) >= DATABASE_TARGET)):
            conn.execute("set lock_timeout = '8s'")
            try:
                conn.execute(f"vacuum full public.{table}")
            finally:
                conn.execute("reset lock_timeout")
    return total


def main() -> None:
    db_url = os.environ["SUPABASE_DB_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    mode = os.environ.get("CAPACITY_MODE", "archive")
    if mode not in {"audit", "reclaim-history", "archive", "archive-and-clean", "rollover"}:
        raise ValueError("Unknown database capacity mode")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    with psycopg.connect(db_url, autocommit=True) as conn, httpx.Client(base_url=PROJECT_URL, headers=headers, timeout=180) as storage, TemporaryDirectory() as temp:
        directory = Path(temp)
        report_capacity(conn)
        if mode == "audit":
            archive_analysis(conn, storage, measure=True)
            return
        ensure_private_bucket(storage)
        if mode == "reclaim-history":
            projected = archive_analysis(conn, storage, measure=True)
            if projected:
                check_storage_budget(storage, projected)
            archive_analysis(conn, storage, retry_vacuum=True)
            report_capacity(conn)
            size = database_bytes(conn)
            if size >= RADAR_START_LIMIT:
                raise RuntimeError(f"PostgreSQL still above Radar reserve after history compaction: {size:,} bytes")
            if size >= DATABASE_TARGET:
                print("::warning::PostgreSQL remains above the 400 MB operating target", flush=True)
            return
        # A unique path prevents a failed or partial attempt from overwriting an earlier archive.
        run_id = os.environ["GITHUB_RUN_ID"] + "-" + os.environ.get("GITHUB_RUN_ATTEMPT", "1")
        cutoff = date.today() - timedelta(days=RESEARCH_RETENTION_DAYS)
        assessment_cutoff = date.today() - timedelta(days=ASSESSMENT_RETENTION_DAYS)
        archive_specs = [(name, table, predicate.format(assessment_cutoff=assessment_cutoff.isoformat()))
                         for name, table, predicate in ARCHIVES
                         if mode != "rollover" or name in {"research_price_bars", "research_price_sync_status", "cold_challenger_strategies"}]
        print("Before maintenance:", conn.execute("""select relname, pg_total_relation_size(relid), n_live_tup, n_dead_tup
            from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 8""").fetchall())
        entries = []
        for name, table, predicate in archive_specs:
            entry = archive_table(conn, directory, name, table, predicate)
            if not entry["rows"] or (mode == "rollover" and name == "research_price_sync_status"):
                continue
            if entry["bytes"] > 45 * 1024 * 1024:
                raise RuntimeError(f"Archive {name} exceeds safe free-plan upload size; split it before cleanup")
            upload_verified(storage, f"capacity/{run_id}/{entry['filename']}", (directory / entry["filename"]).read_bytes())
            entries.append(entry)
            print(f"Archived and verified {name}: {entry['rows']} rows, {entry['bytes']} compressed bytes")
        manifest = {"run_id": run_id, "project_ref": "upmqxwktvvguegqeqibn", "entries": entries,
                    "research_price_cutoff": cutoff.isoformat(),
                    "live_versions": {"funnel": LIVE_FUNNEL, "macd": LIVE_MACD,
                                      "zones": LIVE_ZONES, "challenger": LIVE_CHALLENGER}}
        manifest_path = directory / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        if entries:
            upload_verified(storage, f"capacity/{run_id}/manifest.json", manifest_path.read_bytes(), content_type="application/json")
            print(f"Verified private archive: {BUCKET}/capacity/{run_id}/")
        if mode == "archive":
            return
        # Install the exact, verified per-symbol objects that research readers use
        # before removing their PostgreSQL cache. CSV snapshots remain recoverable.
        research = ResearchArchive(PROJECT_URL, key)
        try:
            with conn.cursor() as cursor:
                cursor.execute("""select symbol_id, jsonb_agg(to_jsonb(t) order by trading_date)
                    from public.research_price_bars t group by symbol_id""")
                for symbol_id, rows in cursor.fetchall():
                    merged = {row["trading_date"]: row for row in research.read(symbol_id)}
                    merged.update({row["trading_date"]: row for row in rows})
                    research.write(symbol_id, sorted(merged.values(), key=lambda row: row["trading_date"]))
        finally:
            research.close()
        # Counts must still match the snapshots just archived. Abort if another job wrote
        # to any target between export and cleanup. Current release rows are never touched.
        with conn.transaction():
            with conn.cursor() as cursor:
                for table in sorted({entry["table"] for entry in entries}):
                    cursor.execute(f"lock table {table} in share row exclusive mode")
                for entry in entries:
                    cursor.execute(f"select count(*), coalesce(sum(hashtextextended(row_to_json(t)::text,0)::numeric),0)::text from {entry['table']} t where {entry['predicate']}")
                    if cursor.fetchone() != (entry["rows"], entry["fingerprint"]):
                        raise RuntimeError(f"Rows changed since archive: {entry['name']}")
                for entry in entries:
                    if entry["name"] != "research_price_sync_status":
                        cursor.execute(f"delete from {entry['table']} t where {entry['predicate']}")
        # VACUUM FULL must run outside a transaction and can lock these tables briefly.
        if mode == "archive-and-clean":
            for table in ("public.research_price_bars", "public.signal_funnel_assessments",
                          "public.macd_divergence_assessments", "public.support_resistance_zones",
                          "public.challenger_strategy_assessments", "public.daily_prices",
                          "public.derived_bars"):
                conn.execute(f"vacuum full {table}")
        else:
            for table in ("public.research_price_bars", "public.challenger_strategy_assessments"):
                conn.execute(f"vacuum (analyze) {table}")
            if database_bytes(conn) >= DATABASE_TARGET:
                archive_analysis(conn, storage)
        with conn.cursor() as cursor:
            cursor.execute("select pg_database_size(current_database())")
            size_bytes = cursor.fetchone()[0]
            print(f"Database size after cleanup: {size_bytes / 1024 / 1024:.1f} MiB")
            if size_bytes >= 400_000_000:
                print("::warning::Database remains above the 400 MB operating target; core price history has been preserved")
            if mode == "archive-and-clean" and size_bytes >= 500_000_000:
                raise RuntimeError("Database remains above the Free 500 MB limit after cleanup; EOD repair was not dispatched")


if __name__ == "__main__":
    main()
