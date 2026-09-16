from dataclasses import fields
from pathlib import Path

from protstock.indicators import IndicatorSnapshot


def test_every_indicator_snapshot_field_has_a_persisted_column() -> None:
    """Prevent pipeline-wide EOD failures when an indicator field is added."""
    migrations = Path("supabase/migrations")
    snapshot_schema = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(migrations.glob("*.sql"))
        if "technical_snapshots" in path.read_text(encoding="utf-8")
    )
    missing = [field.name for field in fields(IndicatorSnapshot) if field.name not in snapshot_schema]
    assert missing == []
