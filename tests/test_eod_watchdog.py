from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_eod_watchdog_has_both_recovery_stages_and_targeted_retry() -> None:
    workflow = (ROOT / ".github/workflows/eod-watchdog.yml").read_text(encoding="utf-8")
    assert "options: [early, final]" in workflow
    assert "needs.inspect.outputs.action == 'DISPATCH_FAST_LANE'" in workflow
    assert "--source VCI --symbol-offset" in workflow
    assert "--source KBS --symbol-offset" in workflow
    assert "Dữ liệu tạm thời:" in workflow
    assert "protstock send-eod-alerts" in workflow


def test_watchdog_migration_schedules_1620_and_1650_with_vault_token() -> None:
    migration = (ROOT / "supabase/migrations/20260914110000_eod_watchdog_cron.sql").read_text(encoding="utf-8")
    assert "github_eod_watchdog_token" in migration
    assert "'20 9 * * 1-5'" in migration
    assert "'50 9 * * 1-5'" in migration
    assert "eod-watchdog.yml/dispatches" in migration