from datetime import date

from protstock.alerts import build_telegram_message
from protstock.eod import _write_analysis


class RecordingClient:
    def __init__(self) -> None:
        self.core_signals: list[dict] = []

    def upsert(self, _table, rows, _on_conflict):
        return len(list(rows))

    def upsert_core_engine_signal(self, payload):
        self.core_signals.append(payload)
        return 1


def _result(action: str, reasons: list[str]) -> dict:
    return {
        "as_of_date": "2026-09-11",
        "indicators": {"close": 100.0, "rsi14": 55.0},
        "patterns": [],
        "signal_preview": action,
        "reasons": reasons,
    }


def _write(client: RecordingClient, result: dict) -> None:
    _write_analysis(
        client, 42, "D", [{"date": "2026-09-11"}], [], [],
        {"snapshots": 0, "patterns": 0, "zones": 0, "signals": 0}, result, {},
    )


def test_core_engine_skips_generic_watch() -> None:
    client = RecordingClient()
    _write(client, {**_result("WATCH", ["TREND_UP"]), "zones": []})
    assert client.core_signals == []


def test_core_engine_persists_near_trigger_watch() -> None:
    client = RecordingClient()
    _write(client, {**_result("WATCH", ["TREND_UP", "NEAR_TRIGGER_ACCUMULATION_BASE"]), "zones": []})
    assert client.core_signals == [{
        "rule_version_id": None, "source": "CORE_ENGINE", "symbol_id": 42,
        "timeframe": "D", "as_of_date": "2026-09-11", "action": "WATCH",
        "score": 100, "reasons": ["TREND_UP", "NEAR_TRIGGER_ACCUMULATION_BASE"],
        "evidence": {"close": 100.0, "rsi14": 55.0},
    }]


def test_core_engine_alert_uses_fallback_label() -> None:
    text = build_telegram_message(
        {"action": "PROBE_BUY", "symbols": {"symbol": "VNM"}, "rule_versions": None, "reasons": ["BREAKOUT"]},
        date(2026, 9, 11),
    )
    assert "PROBE_BUY VNM · Prot Core Engine" in text


def test_user_rule_alert_message_is_unchanged() -> None:
    signal = {
        "action": "ADD", "symbols": {"symbol": "FPT"},
        "rule_versions": {"rules": {"name": "RSI pullback"}}, "reasons": ["RSI14_LOW"],
    }
    assert build_telegram_message(signal, date(2026, 9, 11)) == (
        "Prot Stock EOD · 11/09/2026\nADD FPT · RSI pullback\nRSI14_LOW"
    )


def test_core_engine_migration_keeps_rows_visible_under_owner_rls() -> None:
    migration = open("supabase/migrations/20260911010000_consolidate_core_engine_signals.sql", encoding="utf-8").read()
    assert "source = 'CORE_ENGINE'" in migration
    assert "where rv.id = rule_version_id and r.user_id = auth.uid()" in migration
