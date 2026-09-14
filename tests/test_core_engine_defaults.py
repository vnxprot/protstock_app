from pathlib import Path


def test_default_core_catalog_migration_enables_every_core_pack_once():
    migration = Path("supabase/migrations/20260914130000_enable_all_core_engines.sql").read_text(encoding="utf-8")
    assert "kind = 'CORE_PACK'" in migration
    assert "set status = 'ACTIVE'" in migration
    assert "updated_at = now()" in migration
    assert "alter table" not in migration


def test_rule_builder_has_explicit_engine_first_order_and_pack_targets():
    source = Path("src/components/RuleBuilderPage.tsx").read_text(encoding="utf-8")
    assert source.index('"Prot Core Engine v0.0"') < source.index('"Prot Core Engine v1.0"') < source.index('"Prot Core Engine v2.0"')
    assert 'sort(compareEngines)' in source
    assert 'Pack độc lập · qua bộ lọc chung' in source
    assert 'compareEngines' in Path('src/components/BacktestPage.tsx').read_text(encoding='utf-8')
