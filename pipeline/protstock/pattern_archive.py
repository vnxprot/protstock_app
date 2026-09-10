from __future__ import annotations

from datetime import date, timedelta
from typing import Sequence

from .config import Settings
from .supabase_rest import SupabaseRestClient


def can_archive_pattern_evidence(pattern: dict, signals: Sequence[dict], cutoff_date: date) -> bool:
    """Decide archival eligibility without I/O; any unscored signal blocks it."""
    if pattern.get("state") not in {"FAILED", "EXPIRED"} or date.fromisoformat(pattern["as_of_date"]) >= cutoff_date:
        return False
    return all(bool(signal.get("signal_outcomes")) for signal in signals)


def archive_evidence_if_eligible(pattern: dict, signals: Sequence[dict], cutoff_date: date) -> dict:
    """Pure representation used for tests; persistence is performed by the SQL RPC."""
    return {**pattern, "evidence": None} if can_archive_pattern_evidence(pattern, signals, cutoff_date) else dict(pattern)


def archive_pattern_evidence(retention_days: int = 180, today: date | None = None) -> dict:
    if retention_days <= 0:
        raise ValueError("retention_days must be positive")
    client = SupabaseRestClient(Settings.from_env())
    try:
        cutoff = (today or date.today()) - timedelta(days=retention_days)
        archived = client.archive_old_pattern_evidence(cutoff)
        return {"status": "SUCCEEDED", "cutoff_date": cutoff.isoformat(), "archived": archived}
    finally:
        client.close()
