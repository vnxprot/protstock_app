import importlib.util
import pytest
from datetime import datetime, timezone
from pathlib import Path


path = Path(__file__).resolve().parents[1] / ".github" / "scripts" / "eod_status.py"
spec = importlib.util.spec_from_file_location("eod_status", path)
eod_status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eod_status)


def test_watchdog_dispatches_only_when_eod_absent_or_failed():
    assert eod_status.decide("watchdog", [], False) == "DISPATCH_FAST_LANE"
    assert eod_status.decide("watchdog", [{"job_type": "EOD_INGEST", "status": "FAILED"}], False) == "DISPATCH_FAST_LANE"
    assert eod_status.decide("watchdog", [{"job_type": "EOD_INGEST", "status": "RUNNING"}], False) == "IN_PROGRESS"


def test_partial_publication_retries_until_complete_coverage():
    jobs = [
        {"job_type": "EOD_INGEST", "status": "PARTIAL"},
        {"job_type": "DERIVE_BARS", "status": "SUCCEEDED", "counts": {"publication_status": "PARTIAL"}},
    ]
    assert eod_status.decide("watchdog", jobs, True, coverage_status="PARTIAL") == "DISPATCH_FAST_LANE"
    assert eod_status.decide("fast-lane", jobs, True, coverage_status="PARTIAL") == "RUN"
    assert eod_status.decide("fast-lane", jobs, True, force_rerun=True) == "RUN"


def test_breadth_without_signals_is_not_published():
    jobs = [{"job_type": "EOD_INGEST", "status": "SUCCEEDED"}]
    assert eod_status.decide("watchdog", jobs, True) == "DISPATCH_FAST_LANE"


def test_complete_publication_requires_current_revision_and_coverage():
    jobs = [{"job_type": "DERIVE_BARS", "status": "SUCCEEDED", "source_revision": "core-rules-v4.0.0", "counts": {"publication_status": "COMPLETE"}}]
    assert eod_status.decide("watchdog", jobs, True, coverage_status="COMPLETE", source_revision="core-rules-v4.0.0") == "COMPLETE"
    assert eod_status.decide("watchdog", jobs, True, coverage_status="PARTIAL") == "DISPATCH_FAST_LANE"
    assert eod_status.decide("watchdog", jobs, True, coverage_status="COMPLETE", source_revision="core-rules-v5.0.0") == "DISPATCH_FAST_LANE"


def test_stale_running_job_recovers_but_fresh_heartbeat_preserves_lease():
    now = datetime(2026, 10, 2, 10, tzinfo=timezone.utc)
    jobs = [{"job_type": "EOD_INGEST", "status": "RUNNING", "started_at": "2026-10-02T08:00:00Z", "heartbeat_at": "2026-10-02T09:20:00Z"}]
    assert eod_status.decide("watchdog", jobs, False, now=now) == "DISPATCH_FAST_LANE"
    jobs[0]["heartbeat_at"] = "2026-10-02T09:50:00Z"
    assert eod_status.decide("watchdog", jobs, False, now=now) == "IN_PROGRESS"


def test_automatic_retries_are_bounded_and_manual_force_is_explicit():
    jobs = [{"job_type": "EOD_INGEST", "status": "PARTIAL"}] * 6
    assert eod_status.decide("watchdog", jobs, False) == "RETRY_LIMIT"
    assert eod_status.decide("fast-lane", jobs, False) == "SKIP"
    assert eod_status.decide("fast-lane", jobs, False, force_rerun=True) == "RUN"


@pytest.mark.parametrize("symbol_count,batch_sizes", [(260,[130,130]), (265,[132,133])])
def test_dynamic_shards_cover_current_and_expanded_universe_without_duplicates(symbol_count,batch_sizes):
    names = [f"S{i:03}" for i in range(symbol_count)]
    shards = eod_status.balanced_shards([{"symbol": name} for name in reversed(names)] + [{"symbol": names[0]}])
    batches = [row["symbols"].split(",") for row in shards]
    assert [len(batch) for batch in batches] == batch_sizes
    assert sorted(name for batch in batches for name in batch) == names
    assert all(shard["source"] == "KBS" for shard in shards)
