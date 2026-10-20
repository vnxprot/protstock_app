from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_only_fast_lane_has_the_weekday_eod_schedule() -> None:
    standard = (ROOT / ".github/workflows/eod.yml").read_text(encoding="utf-8")
    fast_lane = (ROOT / ".github/workflows/eod-fast.yml").read_text(encoding="utf-8")
    assert "schedule:" not in standard
    assert "cron: \"30 8 * * 1-5\"" in fast_lane


def test_fast_lane_keeps_failures_visible_and_uses_two_parallel_workers() -> None:
    standard = (ROOT / ".github/workflows/eod.yml").read_text(encoding="utf-8")
    fast_lane = (ROOT / ".github/workflows/eod-fast.yml").read_text(encoding="utf-8")
    assert "id: ingest\n        continue-on-error: true" in standard
    assert "name: Send concise Telegram EOD alerts\n        if: always()" in standard
    assert "python .github/scripts/eod_parallel.py" in fast_lane
    assert "VNSTOCK_API_KEY" not in fast_lane
    assert "python .github/scripts/market_source_health.py" in fast_lane
    assert "python .github/scripts/eod_report.py" in fast_lane
    assert "id: ingest\n        continue-on-error: true" not in fast_lane
    assert "id: finalize\n        continue-on-error: true" not in fast_lane
    assert "python .github/scripts/finalize_eod.py" in fast_lane
    assert "name: Send final concise Telegram EOD alerts\n        if: steps.finalize.outcome == 'success'" in fast_lane
