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
from time import sleep
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
import psycopg
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from protstock.research_archive import ResearchArchive, check_storage_budget
from protstock.intraday_spikes import minute_baseline, pack_minute_bars, unpack_minute_bars


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
HOT_ANALYSIS_SESSIONS = 10
JOB_DETAIL_RETENTION_DAYS = 21
ANALYSIS_ARCHIVES = (
    ("challenger_strategy_assessments", "trading_date", ("symbol_id", "engine_version", "strategy_code"),
     "t.trading_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date - 14"),
    ("challenger_signal_assessments", "trading_date", ("id",), "true"),
    ("support_resistance_zones", "as_of_date", ("id",), "true"),
    ("pattern_instances", "as_of_date", ("id",), "true"),
    ("momentum_radar_assessments", "as_of_date", ("symbol_id", "version"), "true"),
    ("signal_funnel_assessments", "as_of_date", ("symbol_id", "version"), "true"),
    ("macd_divergence_assessments", "as_of_date", ("symbol_id", "version", "oscillator", "swings"), "true"),
    ("technical_snapshots", "as_of_date", ("symbol_id", "timeframe", "algorithm_version"), "true"),
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


def compact_relation(conn, table):
    conn.execute("set lock_timeout = '8s'")
    try:
        conn.execute(f"vacuum full public.{table}")
    except psycopg.errors.LockNotAvailable:
        print(f"::warning::Vacuum deferred for {table}: relation busy", flush=True)
    finally:
        conn.execute("reset lock_timeout")


def reclaim_core_bloat(conn):
    relations = conn.execute("""select relname from pg_stat_user_tables
        where schemaname = 'public' and relname in ('daily_prices', 'derived_bars', 'technical_snapshots')
        and n_dead_tup >= 1000 and n_dead_tup >= n_live_tup * 0.02
        order by pg_total_relation_size(relid) desc""").fetchall()
    for (table,) in relations:
        if database_bytes(conn) < DATABASE_TARGET:
            break
        before = database_bytes(conn)
        compact_relation(conn, table)
        print(f"Core relation {table}: database {before:,} -> {database_bytes(conn):,} bytes", flush=True)


def compact_minute_history(conn, storage, *, measure=False):
    days = conn.execute("select distinct trading_date from public.intraday_minute_days order by 1").fetchall()
    count = estimated = 0
    for (day,) in days:
        packed = []
        original = {}
        for symbol_id, version, bars, size in conn.execute("""select symbol_id, xmin::text, bars, pg_column_size(bars)
                from public.intraday_minute_days where trading_date = %s and bars <> '[]'::jsonb""", (day,)):
            decoded = unpack_minute_bars(bars)
            baseline = minute_baseline(decoded)
            if baseline == decoded:
                continue
            value = pack_minute_bars(baseline)
            new_size = len(json.dumps(value, separators=(',', ':')).encode()) + 12
            if new_size >= size:
                continue
            if unpack_minute_bars(value) != baseline:
                raise RuntimeError(f"Minute history compression changed data: {symbol_id} {day}")
            packed.append({"symbol_id": symbol_id, "version": version, "bars": value})
            original[symbol_id] = decoded
            estimated += size - new_size
        if measure:
            count += len(packed)
        elif packed:
            payload = json.dumps(original, sort_keys=True, separators=(',', ':')).encode()
            content = gzip.compress(payload, compresslevel=6, mtime=0)
            digest = hashlib.sha256(content).hexdigest()
            upload_verified(storage, f"capacity/minute-baseline/v1/{day}/{digest}.json.gz", content, reuse=True)
            result = conn.execute("""update public.intraday_minute_days t set bars = p.bars
                from jsonb_to_recordset(%s) as p(symbol_id bigint, version text, bars jsonb)
                where t.trading_date = %s and t.symbol_id = p.symbol_id and t.xmin::text = p.version""", (Jsonb(packed), day))
            count += result.rowcount
    print(f"Minute history {'eligible' if measure else 'compacted'}: {count:,} rows, estimated {estimated:,} payload bytes reclaimed", flush=True)
    if not measure and (count or database_bytes(conn) >= DATABASE_TARGET):
        compact_relation(conn, "intraday_minute_days")


def compact_job_details(conn, storage, directory, run_id, *, measure=False):
    cutoff = conn.execute("select (now() at time zone 'Asia/Ho_Chi_Minh')::date - %s", (JOB_DETAIL_RETENTION_DAYS,)).fetchone()[0]
    predicate = f"created_at < timestamptz '{cutoff} 00:00:00+07' and exists (select 1 from public.job_runs j where j.id=t.job_run_id and j.finished_at < timestamptz '{cutoff} 00:00:00+07' and j.status <> 'RUNNING')"
    entry = archive_table(conn, directory, "old_job_run_items", "public.job_run_items", predicate)
    print(f"Job detail archive: {entry['rows']:,} rows, {entry['bytes']:,} compressed bytes", flush=True)
    if measure or not entry['rows']:
        return
    if entry['bytes'] >= 45_000_000:
        raise RuntimeError("Job detail archive must be split before cleanup")
    prefix = f"capacity/{run_id}/job-details"
    upload_verified(storage, f"{prefix}/{entry['filename']}", (directory / entry['filename']).read_bytes())
    upload_verified(storage, f"{prefix}/manifest.json", json.dumps(entry).encode(), content_type="application/json")
    try:
        with conn.transaction():
            conn.execute("set local lock_timeout = '8s'")
            conn.execute("lock table public.job_runs in share mode")
            conn.execute("lock table public.job_run_items in share row exclusive mode")
            count, fingerprint = conn.execute(f"""select count(*), coalesce(sum(hashtextextended(row_to_json(t)::text,0)::numeric),0)::text
                from public.job_run_items t where {predicate}""").fetchone()
            if (count, fingerprint) != (entry['rows'], entry['fingerprint']):
                print("::warning::Job detail cleanup deferred because the archive selection changed", flush=True)
                return
            conn.execute(f"delete from public.job_run_items t where {predicate}")
    except psycopg.errors.LockNotAvailable:
        print("::warning::Job detail cleanup deferred because the table is busy", flush=True)
        return
    compact_relation(conn, "job_run_items")


def archive_analysis_day(conn, storage, table, day, select, update, *, measure):
    for attempt in range(3):
        count, payloads = conn.execute(select, (day,)).fetchone()
        if not count:
            return 0, 0, 0
        data = payloads.encode()
        content = gzip.compress(data, compresslevel=6, mtime=0)
        if measure:
            return count, len(data), len(content)
        if len(content) >= 45_000_000:
            raise RuntimeError(f"Analysis archive must be split: {table} {day}")
        object_key = f"analysis/v1/{table}/{day}/{hashlib.sha256(content).hexdigest()}.json.gz"
        upload_verified(storage, object_key, content, reuse=True)
        try:
            with conn.transaction():
                conn.execute("set local lock_timeout = '8s'")
                conn.execute(f"lock table public.{table} in share row exclusive mode")
                if conn.execute(select, (day,)).fetchone() == (count, payloads):
                    if conn.execute(update, (object_key, day)).rowcount != count:
                        raise RuntimeError(f"Analysis row count changed: {table} {day}")
                    return count, len(data), len(content)
        except psycopg.errors.LockNotAvailable:
            pass
        if attempt < 2:
            sleep(2 ** attempt)
    print(f"::warning::Analysis batch deferred after 3 attempts: {table} {day}", flush=True)
    return 0, 0, 0


def archive_analysis(conn, storage, *, measure=False, retry_vacuum=False):
    cutoff = conn.execute("""select min(ip.trading_date) from (
        select p.trading_date from public.market_index_prices p join public.market_indices i on i.id=p.index_id
        where i.code='VNINDEX' and p.trading_date <= (now() at time zone 'Asia/Ho_Chi_Minh')::date
        order by p.trading_date desc limit %s) ip
        having count(*)=%s""", (HOT_ANALYSIS_SESSIONS, HOT_ANALYSIS_SESSIONS)).fetchone()
    if cutoff is None:
        print("No complete hot-session calendar for analysis retention", flush=True)
        return 0
    total = 0
    for table, day_column, identity, protected_scope in ANALYSIS_ARCHIVES:
        key = f"concat_ws(':', {', '.join('t.' + column for column in identity)})"
        field = "monthly_context" if table == "technical_snapshots" else "evidence"
        scope = f"t.{field} <> '{{}}'::jsonb and not (t.{field} ? '_historyObject') and ({protected_scope})"
        dates = conn.execute(f"""select distinct t.{day_column} from public.{table} t
            where t.{day_column} < %s and {scope} order by 1""", cutoff).fetchall()
        select = f"""select count(*), coalesce(jsonb_object_agg({key}, jsonb_build_object('evidence', t.{field})), '{{}}'::jsonb)::text
            from public.{table} t
            where t.{day_column} = %s and {scope}"""
        # Keep the monthly state read by the historical Opportunities SQL.
        keep = "jsonb_strip_nulls(jsonb_build_object('monthly_state', t.evidence->'monthly_state')) ||" if table == "momentum_radar_assessments" else ""
        if table == "macd_divergence_assessments":
            keep = """jsonb_strip_nulls(jsonb_build_object('latest_close', t.evidence->'latest_close',
                'local_cross_date', t.evidence->'local_cross_date', 'invalidated_on', t.evidence->'invalidated_on',
                'zones', case when t.evidence->'zones' -> -1 is not null then jsonb_build_array(
                    jsonb_build_object('price_low', t.evidence->'zones' -> -1 -> 'price_low')) end,
                'recovery_breakouts', case when t.evidence->'recovery_breakouts' -> -1 is not null
                    then jsonb_build_array(t.evidence->'recovery_breakouts' -> -1) end)) ||"""
        if table == "technical_snapshots":
            keep = "jsonb_strip_nulls(jsonb_build_object('state', t.monthly_context->'state')) ||"
        update = f"""update public.{table} t set {field} = {keep}
            jsonb_build_object('_historyObject', %s::text, '_historyKey', {key})
            where t.{day_column} = %s and {scope}"""
        rows = compressed = raw = 0
        for (day,) in dates:
            count, raw_bytes, compressed_bytes = archive_analysis_day(conn, storage, table, day, select, update, measure=measure)
            raw += raw_bytes
            compressed += compressed_bytes
            rows += count
        print(f"{table}: {rows:,} rows, {raw:,} raw JSON bytes, {compressed:,} compressed bytes", flush=True)
        total += compressed
        if not measure and (rows or (retry_vacuum and database_bytes(conn) >= DATABASE_TARGET)):
            compact_relation(conn, table)
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
        run_id = os.environ["GITHUB_RUN_ID"] + "-" + os.environ.get("GITHUB_RUN_ATTEMPT", "1")
        report_capacity(conn)
        if mode == "audit":
            compact_minute_history(conn, storage, measure=True)
            compact_job_details(conn, storage, directory, run_id, measure=True)
            archive_analysis(conn, storage, measure=True)
            return
        ensure_private_bucket(storage)
        if mode == "reclaim-history":
            compact_minute_history(conn, storage)
            compact_job_details(conn, storage, directory, run_id)
            projected = archive_analysis(conn, storage, measure=True)
            if projected:
                check_storage_budget(storage, projected)
            archive_analysis(conn, storage, retry_vacuum=True)
            reclaim_core_bloat(conn)
            report_capacity(conn)
            size = database_bytes(conn)
            if size >= RADAR_START_LIMIT:
                raise RuntimeError(f"PostgreSQL still above Radar reserve after history compaction: {size:,} bytes")
            if size >= DATABASE_TARGET:
                print("::warning::PostgreSQL remains above the 400 MB operating target", flush=True)
            return
        # A unique path prevents a failed or partial attempt from overwriting an earlier archive.
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
                compact_job_details(conn, storage, directory, run_id)
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
