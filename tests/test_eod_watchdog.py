from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_eod_watchdog_only_dispatches_a_missing_or_failed_fast_lane() -> None:
    workflow = (ROOT / ".github/workflows/eod-watchdog.yml").read_text(encoding="utf-8")
    assert "python .github/scripts/eod_status.py watchdog" in workflow
    assert "needs.inspect.outputs.action == 'DISPATCH_FAST_LANE'" in workflow
    assert "gh workflow run eod-fast.yml" in workflow
    assert "RETRY_MISSING" not in workflow
    assert "protstock send-eod-alerts" not in workflow


def test_watchdog_migration_replaces_old_jobs_with_one_1535_schedule() -> None:
    migration = (ROOT / "supabase/migrations/20260929040000_single_eod_watchdog.sql").read_text(encoding="utf-8")
    assert "github_eod_watchdog_token" in migration
    assert "'35 8 * * 1-5'" in migration
    assert "protstock-eod-watchdog-1620" in migration
    assert "protstock-eod-watchdog-1650" in migration
    assert "select public.install_eod_watchdog_cron();" in migration
    assert "eod-watchdog.yml/dispatches" in migration
