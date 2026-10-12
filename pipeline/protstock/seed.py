from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

import httpx

from .config import Settings
from .provider_vnstock import VnstockProvider, INDEX_PRICE_UNIT, KBS_SOURCE_VERSION
from .supabase_rest import SupabaseRestClient
from .universe import load_universe


logger = logging.getLogger(__name__)


def seed_universe(path: str | Path) -> dict[str, int | str]:
    """Idempotently load the locked local universe into a fresh database."""
    validation = load_universe(path)
    if not validation.is_valid:
        raise ValueError("Universe CSV is invalid; refusing to seed symbols.")

    client = SupabaseRestClient(Settings.from_env())
    job = client.create_job({
        "job_type": "UNIVERSE_IMPORT",
        "status": "RUNNING",
        "trigger_type": "MANUAL",
        "source_revision": validation.sha256,
    })
    try:
        rows = [
            {
                "symbol": item.symbol,
                "company_name": item.company_name,
                "sector": item.sector,
                "exchange": item.exchange,
                "trading_status": item.trading_status,
                "active": item.active,
                "metadata": {"source": "data/universe.csv", "sha256": validation.sha256},
            }
            for item in validation.rows
        ]
        try:
            written = client.upsert("symbols", rows, "symbol")
            manifest = {item.symbol for item in validation.rows if item.active}
            for extra in client.active_symbols():
                if extra["symbol"] not in manifest:
                    client.deactivate_symbol(extra["symbol"])
            live = {item["symbol"] for item in client.active_symbols()}
            if live != manifest:
                raise RuntimeError(f"Universe does not match manifest: {len(live)}/{len(manifest)} active")
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"Universe seed rejected: {exc.response.text[:500]}") from exc
        client.finish_job(job["id"], {
            "status": "SUCCEEDED",
            "finished_at": _now(),
            "counts": {"symbols": written},
        })
        return {"status": "SUCCEEDED", "symbols": written, "sha256": validation.sha256}
    except Exception as exc:
        client.finish_job(job["id"], {
            "status": "FAILED",
            "finished_at": _now(),
            "error_summary": str(exc)[:500],
        })
        raise
    finally:
        client.close()


def assert_live_universe(path: str | Path) -> dict[str, int]:
    validation = load_universe(path)
    if not validation.is_valid:
        raise ValueError("Universe manifest is invalid")
    expected = {row.symbol for row in validation.rows if row.active}
    client = SupabaseRestClient(Settings.from_env())
    try:
        actual = {row["symbol"] for row in client.active_symbols()}
    finally:
        client.close()
    if actual != expected:
        raise ValueError(f"Live universe differs from manifest: missing={sorted(expected-actual)}, extra={sorted(actual-expected)}")
    return {"active_symbols": len(actual)}


def seed_vnindex_history(
    start_date: date,
    end_date: date | None = None,
    source: str = "KBS",
) -> dict[str, int | str]:
    """Idempotently backfill VNINDEX OHLCV from the implemented KBS adapter."""
    end_date = end_date or date.today()
    primary_source = source.upper()
    client = SupabaseRestClient(Settings.from_env())
    try:
        index = client.market_index("VNINDEX")
        provider = VnstockProvider(primary_source)
        source_used = primary_source
        bars = provider.history("VNINDEX", start_date, end_date)

        rows = [{
            "index_id": index["id"],
            "trading_date": bar.trading_date.isoformat(),
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
            "volume": bar.volume,
            "source": bar.source,
            "collected_at": bar.collected_at.isoformat(),
            "price_unit": INDEX_PRICE_UNIT,
            "source_version": KBS_SOURCE_VERSION,
        } for bar in bars]
        client.upsert("market_index_prices", rows, "index_id,trading_date")
        logger.info("Seeded %s VNINDEX bars from %s", len(rows), source_used)
        return {
            "status": "SUCCEEDED",
            "rows_inserted": len(rows),
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "source_used": source_used,
        }
    finally:
        client.close()


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
