from __future__ import annotations

from pathlib import Path

from .config import Settings
from .supabase_rest import SupabaseRestClient
from .universe import load_universe


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


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
