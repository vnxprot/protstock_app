from pathlib import Path


def test_legacy_core_v1_delete_is_guarded_by_signal_references() -> None:
    migration = Path("supabase/migrations/20260911070000_delete_legacy_core_v1_rules.sql").read_text(encoding="utf-8")
    assert "raise exception 'Legacy Core v1 rule_versions are still referenced by signals" in migration
    assert "where s.rule_version_id = any(legacy_rule_version_ids)" in migration
    assert "delete from public.rule_versions where id = any(legacy_rule_version_ids)" in migration
    assert "delete from public.rules where name in" in migration
    assert "like 'Core v1%'" not in migration
