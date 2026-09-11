from datetime import date

from protstock.alerts import build_telegram_message
from protstock.eod import _write_analysis


class RecordingClient:
    def __init__(self) -> None:
        self.signal_rows: list[dict] = []
        self.consolidated_rows: list[dict] = []
        self.deleted_consolidated: list[tuple[int, str, str]] = []

    def upsert(self, table, rows, _on_conflict):
        payload = list(rows)
        if table == "signals":
            self.signal_rows.extend(payload)
        if table == "consolidated_signals":
            self.consolidated_rows.extend(payload)
        return len(payload)

    def delete_consolidated_signal(self, symbol_id, timeframe, as_of_date):
        self.deleted_consolidated.append((symbol_id, timeframe, as_of_date))


def _result(patterns: list[dict], reasons: list[str]) -> dict:
    return {
        "as_of_date": "2026-09-11",
        "indicators": {"close": 100.0, "rsi14": 55.0, "trend_state": "UP", "volume_avg20": 5_000_000, "volume_ratio20": 1.0},
        "patterns": patterns,
        "zones": [],
        "signal_preview": "WATCH",
        "reasons": reasons,
    }


def _write(client: RecordingClient, result: dict) -> None:
    _write_analysis(
        client, 42, "D", [{"date": "2026-09-11"}], [],
        [{"id": "v2", "dsl": {"engine": "core_ladder_v2", "timeframe": "D", "overrides": {}}, "rules": {"kind": "CORE_PACK"}}],
        {"snapshots": 0, "patterns": 0, "zones": 0, "signals": 0}, result,
        {"weekly_patterns": [], "monthly_snapshot": {}, "candidate_sector": "TECH"},
    )


def test_core_pack_skips_generic_watch() -> None:
    client = RecordingClient()
    _write(client, _result([], ["TREND_UP"]))
    assert client.signal_rows == []
    assert client.deleted_consolidated == [(42, "D", "2026-09-11")]


def test_toggleable_core_v2_writes_meaningful_watch_and_consolidates_it() -> None:
    client = RecordingClient()
    ready = {"pattern_type": "ACCUMULATION_BASE", "state": "READY", "direction": "BULLISH", "quality_score": 50, "start_index": 0, "end_index": 0, "trigger_price": 101, "invalidation_price": 95, "evidence": {}, "reasons": []}
    _write(client, _result([ready], ["TREND_UP", "NEAR_TRIGGER_ACCUMULATION_BASE"]))
    assert client.signal_rows[0]["source"] == "CORE_PACK"
    assert client.consolidated_rows[0]["consensus_engines"] == ["core_ladder_v2"]


def test_core_v2_flows_through_active_rule_versions() -> None:
    client = RecordingClient()
    ready = {"pattern_type": "ACCUMULATION_BASE", "state": "READY", "direction": "BULLISH", "quality_score": 50, "start_index": 0, "end_index": 0, "trigger_price": 101, "invalidation_price": 95, "evidence": {}, "reasons": []}
    _write(client, _result([ready], ["TREND_UP", "NEAR_TRIGGER_ACCUMULATION_BASE"]))
    assert client.signal_rows == [{
        "rule_version_id": "v2", "symbol_id": 42, "timeframe": "D", "as_of_date": "2026-09-11",
        "action": "WATCH", "source": "CORE_PACK", "score": 100,
        "reasons": ["TREND_UP", "NEAR_TRIGGER_ACCUMULATION_BASE"],
        "evidence": {"close": 100.0, "rsi14": 55.0, "trend_state": "UP", "volume_avg20": 5000000, "volume_ratio20": 1.0},
    }]
    assert client.consolidated_rows == [{
        "symbol_id": 42, "timeframe": "D", "as_of_date": "2026-09-11", "composite_action": "WATCH",
        "confluence_score": 70, "confluence_count": 1, "consensus_engines": ["core_ladder_v2"],
        "reasons": ["TREND_UP", "NEAR_TRIGGER_ACCUMULATION_BASE"],
    }]


def test_core_pack_alert_uses_versioned_label() -> None:
    text = build_telegram_message(
        {"action": "PROBE_BUY", "symbol": "VNM", "kind": "CORE_PACK", "rule_name": "Prot Core Engine v2.0", "pack_version": "v2.0", "reasons": ["BREAKOUT"]},
        date(2026, 9, 11),
    )
    assert "PROBE_BUY VNM · Prot Core Engine v2.0" in text


def test_user_rule_alert_uses_rule_studio_label() -> None:
    signal = {"action": "ADD", "symbols": {"symbol": "FPT"}, "rule_versions": {"rules": {"kind": "USER_RULE", "name": "RSI pullback"}}, "reasons": ["RSI14_LOW"]}
    assert "ADD FPT · Rule Studio: RSI pullback" in build_telegram_message(signal, date(2026, 9, 11))


def test_legacy_null_fk_alert_uses_defensive_fallback() -> None:
    text = build_telegram_message({"action": "PROBE_BUY", "symbols": {"symbol": "VNM"}, "rule_versions": None, "reasons": ["BREAKOUT"]}, date(2026, 9, 11))
    assert "PROBE_BUY VNM · Prot Core Engine" in text


def test_core_engine_migration_keeps_rows_visible_under_owner_rls() -> None:
    migration = open("supabase/migrations/20260911010000_consolidate_core_engine_signals.sql", encoding="utf-8").read()
    assert "source = 'CORE_ENGINE'" in migration
    assert "where rv.id = rule_version_id and r.user_id = auth.uid()" in migration
