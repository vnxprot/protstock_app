"""Limit the SSI cutover to complete, archived series."""
from datetime import timedelta
import gzip
from hashlib import sha256
import json
from math import isclose

import httpx

from .provider_market import ProviderDataError
from .research_archive import BUCKET, check_storage_budget

ROLLOUT_LIMIT = 480_000_000


def verify_price_window(stored, fetched):
    if not stored:
        raise ProviderDataError("SSI cutover requires a previous price window")
    fetched_by_day = {bar.trading_date.isoformat(): bar for bar in fetched}
    if any(row["trading_date"] not in fetched_by_day for row in stored):
        raise ProviderDataError("SSI price history does not cover existing sessions")
    # A compact guard for units and adjustment basis, including dates before corporate actions.
    for row in stored:
        bar = fetched_by_day[row["trading_date"]]
        if any(not isclose(float(row[field]), float(getattr(bar, field)), rel_tol=0.02, abs_tol=0.005)
               for field in ("open", "high", "low", "close")):
            raise ProviderDataError(f"SSI price basis differs on {row['trading_date']}")


def rollout_symbols(db, day, limit):
    response = db._request("POST", "/rpc/market_radar_storage", json={"p_prune": False})
    response.raise_for_status()
    if int(response.json()) >= ROLLOUT_LIMIT:
        print(f"::notice::SSI price cutover deferred at {ROLLOUT_LIMIT // 1_000_000} MB PostgreSQL", flush=True)
        return []
    migrated = db._pages("daily_prices", {"select": "symbol_id", "source": "eq.SSI_FASTCONNECT",
        "trading_date": f"gte.{(day - timedelta(days=60)).isoformat()}", "order": "trading_date.desc,symbol_id.asc"})
    active = db.active_symbols()
    ids = {item["symbol_id"] for item in migrated}
    pending = [item["symbol"] for item in active if item["id"] not in ids]
    pending.sort(key=lambda symbol: sha256(f"{day}:{symbol}".encode()).digest())
    return pending[:limit] if limit is not None else pending


def archive_price_window(db, table, key, rows):
    if not rows:
        return
    response = db._request("POST", "/rpc/market_radar_storage", json={"p_prune": False})
    response.raise_for_status()
    if int(response.json()) >= ROLLOUT_LIMIT:
        raise ProviderDataError("PostgreSQL capacity prevents the SSI cutover")
    settings = db._settings
    content = gzip.compress(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode(), mtime=0)
    checksum = sha256(content).hexdigest()
    path = f"{BUCKET}/ssi-cutover/{table}/{int(key)}/{checksum}.json.gz"
    with httpx.Client(base_url=settings.supabase_url, headers={
        "apikey": settings.service_role_key, "Authorization": f"Bearer {settings.service_role_key}",
    }, timeout=30) as client:
        check_storage_budget(client, len(content) + 1024)
        status = client.get(f"/storage/v1/bucket/{BUCKET}")
        status.raise_for_status()
        if status.json().get("public") is not False:
            raise ProviderDataError("SSI rollback archive requires the private archive bucket")
        client.post(f"/storage/v1/object/{path}", content=content, headers={
            "Content-Type": "application/gzip", "x-upsert": "true",
        }).raise_for_status()
        readback = client.get(f"/storage/v1/object/authenticated/{path}")
        readback.raise_for_status()
        if sha256(readback.content).hexdigest() != checksum:
            raise ProviderDataError("SSI rollback archive checksum mismatch")
