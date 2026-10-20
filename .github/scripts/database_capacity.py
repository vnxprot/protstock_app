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
from protstock.research_archive import ResearchArchive


PROJECT_URL = "https://upmqxwktvvguegqeqibn.supabase.co"
BUCKET = "database-archives"
LIVE_FUNNEL = "MTF_FUNNEL_SHADOW_V0_0_0_TREND1"
LIVE_MACD = "MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0"
LIVE_ZONES = "core-rules-v0.0.0-trend1"
LIVE_CHALLENGER = "v0.0.0-challenger-trend1"
RESEARCH_RETENTION_DAYS = 400
ASSESSMENT_RETENTION_DAYS = 180
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


def upload_verified(client: httpx.Client, directory: Path, key: str, path: Path) -> None:
    with path.open("rb") as source:
        storage_request(client, "POST", f"/storage/v1/object/{BUCKET}/{key}",
                        content=source.read(), headers={"Content-Type": "application/gzip", "x-upsert": "false"})
    remote = storage_request(client, "GET", f"/storage/v1/object/authenticated/{BUCKET}/{key}").content
    if hashlib.sha256(remote).hexdigest() != digest(path):
        raise RuntimeError(f"Archive verification failed: {key}")


def main() -> None:
    db_url = os.environ["SUPABASE_DB_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    mode = os.environ.get("CAPACITY_MODE", "archive")
    if mode not in {"archive", "archive-and-clean", "rollover"}:
        raise ValueError("CAPACITY_MODE must be archive, archive-and-clean, or rollover")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    with psycopg.connect(db_url, autocommit=True) as conn, httpx.Client(base_url=PROJECT_URL, headers=headers, timeout=180) as storage, TemporaryDirectory() as temp:
        directory = Path(temp)
        ensure_private_bucket(storage)
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
            if entry["bytes"] > 45 * 1024 * 1024:
                raise RuntimeError(f"Archive {name} exceeds safe free-plan upload size; split it before cleanup")
            upload_verified(storage, directory, f"capacity/{run_id}/{entry['filename']}", directory / entry["filename"])
            entries.append(entry)
            print(f"Archived and verified {name}: {entry['rows']} rows, {entry['bytes']} compressed bytes")
        manifest = {"run_id": run_id, "project_ref": "upmqxwktvvguegqeqibn", "entries": entries,
                    "research_price_cutoff": cutoff.isoformat(),
                    "live_versions": {"funnel": LIVE_FUNNEL, "macd": LIVE_MACD,
                                      "zones": LIVE_ZONES, "challenger": LIVE_CHALLENGER}}
        manifest_path = directory / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        upload_verified(storage, directory, f"capacity/{run_id}/manifest.json", manifest_path)
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
