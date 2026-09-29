import importlib.util
from pathlib import Path


path = Path(__file__).resolve().parents[1] / ".github" / "scripts" / "eod_status.py"
spec = importlib.util.spec_from_file_location("eod_status", path)
eod_status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eod_status)


def test_watchdog_dispatches_only_when_eod_absent_or_failed():
    assert eod_status.decide("watchdog", [], False) == "DISPATCH_FAST_LANE"
    assert eod_status.decide("watchdog", [{"job_type": "EOD_INGEST", "status": "FAILED"}], False) == "DISPATCH_FAST_LANE"
    assert eod_status.decide("watchdog", [{"job_type": "EOD_INGEST", "status": "RUNNING"}], False) == "IN_PROGRESS"


def test_completed_partial_coverage_does_not_dispatch_again():
    jobs = [
        {"job_type": "EOD_INGEST", "status": "PARTIAL"},
        {"job_type": "DERIVE_BARS", "status": "SUCCEEDED"},
    ]
    assert eod_status.decide("watchdog", jobs, True) == "COMPLETE"
    assert eod_status.decide("fast-lane", jobs, True) == "SKIP"
    assert eod_status.decide("fast-lane", jobs, True, force_rerun=True) == "RUN"


def test_breadth_without_signals_is_not_published():
    jobs = [{"job_type": "EOD_INGEST", "status": "SUCCEEDED"}]
    assert eod_status.decide("watchdog", jobs, True) == "DISPATCH_FAST_LANE"
