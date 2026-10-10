"""Archive superseded screening data before reclaiming production database space.

Run only from the manual database-capacity workflow. The archive is verified by
downloading it from the private Storage bucket before any database row is removed.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
import psycopg


PROJECT_URL = "https://upmqxwktvvguegqeqibn.supabase.co"
BUCKET = "database-archives"
LIVE_FUNNEL = "MTF_FUNNEL_SHADOW_V2"
LIVE_MACD = "MACD_BULLISH_DIVERGENCE_ZONE_V4"
RESEARCH_RETENTION_DAYS = 400
ARCHIVES = (
    ("research_price_bars", "public.research_price_bars", "true"),
    ("research_price_sync_status", "public.research_price_sync_status", "true"),
    ("legacy_funnel", "public.signal_funnel_assessments", "version <> 'MTF_FUNNEL_SHADOW_V2'"),
    ("legacy_macd", "public.macd_divergence_assessments", "version <> 'MACD_BULLISH_DIVERGENCE_ZONE_V4'"),
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
        cursor.execute(f"select count(*) from {table} where {predicate}")
        count = cursor.fetchone()[0]
        with gzip.open(target, "wb", compresslevel=9) as compressed:
            with cursor.copy(f"copy (select * from {table} where {predicate}) to stdout with (format csv, header true)") as copy:
                for block in copy:
                    compressed.write(block)
    return {"name": name, "table": table, "predicate": predicate, "rows": count,
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
        archive_specs = ([("expiring_research_price_bars", "public.research_price_bars",
                           f"trading_date < date '{cutoff.isoformat()}'")]
                         if mode == "rollover" else ARCHIVES)
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
                    "live_versions": {"funnel": LIVE_FUNNEL, "macd": LIVE_MACD}}
        manifest_path = directory / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        upload_verified(storage, directory, f"capacity/{run_id}/manifest.json", manifest_path)
        print(f"Verified private archive: {BUCKET}/capacity/{run_id}/")
        if mode == "archive":
            return
        # Counts must still match the snapshots just archived. Abort if another job wrote
        # to any target between export and cleanup. Live V2/V4 rows are never touched.
        with conn.transaction():
            with conn.cursor() as cursor:
                for entry in entries:
                    cursor.execute(f"select count(*) from {entry['table']} where {entry['predicate']}")
                    if cursor.fetchone()[0] != entry["rows"]:
                        raise RuntimeError(f"Rows changed since archive: {entry['name']}")
                cursor.execute("delete from public.research_price_bars where trading_date < %s", (cutoff,))
                if mode == "archive-and-clean":
                    cursor.execute("delete from public.signal_funnel_assessments where version <> %s", (LIVE_FUNNEL,))
                    cursor.execute("delete from public.macd_divergence_assessments where version <> %s", (LIVE_MACD,))
                cursor.execute("""update public.research_price_sync_status s
                    set requested_start_date = greatest(s.requested_start_date, %s),
                        first_date = (select min(r.trading_date) from public.research_price_bars r where r.symbol_id = s.symbol_id),
                        vendor_bars = (select count(*) from public.research_price_bars r where r.symbol_id = s.symbol_id),
                        stored_bars = (select count(*) from public.daily_prices d where d.symbol_id = s.symbol_id
                                       and d.trading_date >= greatest(s.requested_start_date, %s)
                                       and d.trading_date <= s.requested_end_date),
                        coverage_status = case when exists
                            (select 1 from public.research_price_bars r where r.symbol_id = s.symbol_id)
                            then s.coverage_status else 'INCOMPLETE' end""", (cutoff, cutoff))
        # VACUUM FULL must run outside a transaction and can lock these tables briefly.
        if mode == "archive-and-clean":
            for table in ("public.research_price_bars", "public.signal_funnel_assessments", "public.macd_divergence_assessments"):
                conn.execute(f"vacuum full {table}")
        with conn.cursor() as cursor:
            cursor.execute("select pg_database_size(current_database())")
            print(f"Database size after cleanup: {cursor.fetchone()[0] / 1024 / 1024:.1f} MiB")


if __name__ == "__main__":
    main()
