from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_only_fast_lane_has_the_weekday_eod_schedule() -> None:
    standard = (ROOT / ".github/workflows/eod.yml").read_text(encoding="utf-8")
    fast_lane = (ROOT / ".github/workflows/eod-fast.yml").read_text(encoding="utf-8")
    assert "schedule:" not in standard
    assert "cron: \"15 9 * * 1-5\"" in fast_lane


def test_eod_workflows_continue_to_telegram_after_partial_ingestion() -> None:
    standard = (ROOT / ".github/workflows/eod.yml").read_text(encoding="utf-8")
    fast_lane = (ROOT / ".github/workflows/eod-fast.yml").read_text(encoding="utf-8")
    assert "id: ingest\n        continue-on-error: true" in standard
    assert "name: Send concise Telegram EOD alerts\n        if: always()" in standard
    assert "if: always()\n    runs-on: ubuntu-latest" in fast_lane
    assert "id: ingest\n        continue-on-error: true" in fast_lane
    assert "id: finalize\n        continue-on-error: true" in fast_lane
    assert "name: Send final concise Telegram EOD alerts\n        if: always()" in fast_lane
