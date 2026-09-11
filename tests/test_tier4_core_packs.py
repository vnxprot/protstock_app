from datetime import date, timedelta

from protstock import alerts
from protstock.engines import evaluate_core_v1, evaluate_named_engine
from protstock.patterns import detect_pullback_continuation
from protstock.rules import evaluate_rule


def _bars(count: int = 60) -> list[dict]:
    start = date(2026, 1, 1)
    rows = []
    for index in range(count):
        close = 90 + index * 0.2
        rows.append({"date": (start + timedelta(days=index)).isoformat(), "open": close - 0.3, "high": close + 0.5, "low": close - 0.6, "close": close, "volume": 100})
    return rows


def test_custom_dsl_path_is_byte_for_byte_the_existing_evaluator() -> None:
    bars = _bars()
    dsl = {"action": "PROBE_BUY", "all": [{"metric": "volume_ratio20", "op": ">", "value": 1.5}]}
    snapshot = {"volume_ratio20": 2.0}
    expected = evaluate_rule(dsl, snapshot, bars, [])
    passed, action, reasons = evaluate_named_engine(None, {}, {"dsl": dsl, "snapshot": snapshot, "bars": bars, "patterns": []})
    assert (passed, reasons) == expected
    assert action == "PROBE_BUY"


def test_core_v1_reproduces_archived_accumulation_rule() -> None:
    context = {
        "snapshot": {"volume_ratio20": 1.6, "rsi14": 55},
        "patterns": [{"pattern_type": "ACCUMULATION_BASE", "state": "CONFIRMED"}],
        "multi_timeframe_context": None,
    }
    assert evaluate_core_v1(context) == (True, "PROBE_BUY", ["CORE_V1_ACCUMULATION_BASE_CONFIRMED", "VOLUME_CONFIRMED", "RSI_OK"])


def test_pullback_confirms_with_average_volume_not_breakout_volume() -> None:
    bars = _bars()
    bars[-1].update(open=99.6, high=100.7, low=99.3, close=100.0, volume=115)
    snapshot = {"trend_state": "UP", "ema20": 100.5, "sma50": 98.0, "sma200": 90.0, "volume_ratio20": 1.15}
    pattern = detect_pullback_continuation(bars, snapshot)
    assert pattern is not None and pattern.state == "CONFIRMED"
    assert pattern.invalidation_price == 95.06
    assert "VOLUME_AT_LEAST_AVERAGE" in pattern.reasons


def test_pullback_engine_uses_the_precomputed_pattern() -> None:
    passed, action, reasons = evaluate_named_engine("pullback_continuation_v1", {}, {
        "patterns": [{"pattern_type": "PULLBACK_CONTINUATION", "state": "CONFIRMED", "reasons": ["EMA20_SUPPORT"]}],
        "multi_timeframe_context": None,
    })
    assert (passed, action) == (True, "PROBE_BUY")
    assert "PATTERN_PULLBACK_CONTINUATION_CONFIRMED" in reasons


def test_core_pack_migration_has_safe_schema_seed_and_priority_contract() -> None:
    migration = open("supabase/migrations/20260911060000_core_rule_packs.sql", encoding="utf-8").read()
    for column in ("kind text not null default 'USER_RULE'", "pack_version text", "notification_mode text not null default 'TELEGRAM'", "blocks_new_entries boolean not null default false"):
        assert column in migration
    assert "with check (user_id = auth.uid() and kind = 'USER_RULE')" in migration
    assert "Prot Core Engine v2.0" in migration and "core_ladder_v2" in migration
    assert "Prot Core Engine v1.0" in migration and "core_ladder_v1" in migration
    assert "Prot Core Pack · Pullback Continuation" in migration and "'ARCHIVED'" in migration
    assert "when 'EXIT' then 0" in migration
    assert "when 'REDUCE' then 1" in migration
    assert "signal.action = 'WATCH' and coalesce(rule.blocks_new_entries, false) then 2" in migration
    assert "when signal.action = 'PROBE_BUY' then 4" in migration


class _Response:
    def __init__(self, rows): self.rows = rows
    def raise_for_status(self): pass
    def json(self): return self.rows


class _Rest:
    def __init__(self): self.effective_params = None
    def get(self, path, params=None):
        if path == "/effective_signals":
            self.effective_params = params
            # The winning RECORD_ONLY row is excluded by the database filter.
            return _Response([])
        return _Response([])


class _Client:
    def __init__(self): self._client = _Rest()
    def close(self): pass


def test_record_only_effective_signal_never_reaches_telegram(monkeypatch) -> None:
    client, sent = _Client(), []
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "chat")
    monkeypatch.setattr(alerts, "SupabaseRestClient", lambda _settings: client)
    monkeypatch.setattr(alerts.Settings, "from_env", lambda: object())
    monkeypatch.setattr(alerts.httpx, "post", lambda *args, **kwargs: sent.append(kwargs) or _Response({"ok": True}))
    result = alerts.send_eod_telegram_alerts(date(2026, 9, 11))
    assert client._client.effective_params["notification_mode"] == "eq.TELEGRAM"
    assert result["sent"] == 0 and sent == []
