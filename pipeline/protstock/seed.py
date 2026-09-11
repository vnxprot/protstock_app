from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

from .config import Settings
from .provider_vnstock import VnstockProvider
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
                "sector": item.sector,
                "active": item.active,
                "metadata": {"source": "data/universe.csv", "sha256": validation.sha256},
            }
            for item in validation.rows
        ]
        written = client.upsert("symbols", rows, "symbol")
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


def seed_vnindex_history(
    start_date: date,
    end_date: date | None = None,
    source: str = "KBS",
) -> dict[str, int | str]:
    """Idempotently backfill VNINDEX OHLCV, with one alternate free source."""
    end_date = end_date or date.today()
    primary_source = source.upper()
    fallback_source = "VCI" if primary_source == "KBS" else "KBS"
    client = SupabaseRestClient(Settings.from_env())
    try:
        index = client.market_index("VNINDEX")
        provider = VnstockProvider(primary_source)
        source_used = primary_source
        try:
            bars = provider.history("VNINDEX", start_date, end_date)
        except Exception as primary_error:
            logger.warning(
                "VNINDEX fetch failed from %s (%s); retrying %s",
                primary_source,
                type(primary_error).__name__,
                fallback_source,
            )
            try:
                bars = VnstockProvider(fallback_source).history("VNINDEX", start_date, end_date)
                source_used = fallback_source
            except Exception as fallback_error:
                raise RuntimeError(
                    f"VNINDEX fetch failed from {primary_source} and {fallback_source} "
                    f"({type(primary_error).__name__}, {type(fallback_error).__name__})"
                ) from fallback_error

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
