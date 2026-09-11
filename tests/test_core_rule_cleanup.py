from pathlib import Path


def test_legacy_core_v1_delete_is_guarded_by_signal_references() -> None:
    migration = Path("supabase/migrations/20260911070000_delete_legacy_core_v1_rules.sql").read_text(encoding="utf-8")
    assert "raise exception 'Legacy Core v1 rule_versions are still referenced by signals" in migration
    assert "where s.rule_version_id = any(legacy_rule_version_ids)" in migration
    assert "delete from public.rule_versions where id = any(legacy_rule_version_ids)" in migration
    assert "delete from public.rules where name in" in migration
    assert "like 'Core v1%'" not in migration


def test_pullback_pack_name_and_copy_match_the_scoped_daily_contract() -> None:
    source = Path("src/components/RuleBuilderPage.tsx").read_text(encoding="utf-8")
    migration = Path("supabase/migrations/20260911080000_rename_pullback_core_pack.sql").read_text(encoding="utf-8")
    name = "Prot Core Pack · Hồi về hỗ trợ (Pullback Continuation, khung Ngày)"
    assert name in source
    assert "trend_state = UP" in source
    assert "±2% quanh EMA20" in source
    assert "SMA50 (Ngày) trừ 3%" in source
    assert f"set name = '{name}'" in migration
    assert "where name = 'Prot Core Pack · Pullback Continuation'" in migration
    assert "and kind = 'CORE_PACK'" in migration
