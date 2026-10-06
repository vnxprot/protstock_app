from datetime import date, timedelta

from protstock.challenger_engine import assess_challenger, assess_challenger_strategies
from protstock.eod import _write_challenger_shadow


def bars(count=50, close=10.0):
    first = date(2026, 7, 1)
    return [{"date": (first + timedelta(days=i)).isoformat(), "open": close, "high": close + .2,
             "low": close - .2, "close": close, "volume": 2_000_000} for i in range(count)]


def market(state="UP"):
    return {"vnindex_snapshot": {"trend_state": state},
            "breadth": {"pct_above_sma50": 60, "coverage_status": "COMPLETE"}}


def test_early_probe_is_shadow_only_and_reduced_size(monkeypatch):
    rows = bars()
    monkeypatch.setattr("protstock.challenger_engine.assess_macd_zone_divergence", lambda *_: [{
        "stage": "CONFIRMED", "trigger_date": rows[-1]["date"], "invalidation_price": 9.5,
        "setup_id": "macd-one", "evidence": {"breakout_volume_ratio20": 1.1}}])
    result = assess_challenger(1, rows, market(), monthly_state="UP")
    assert result["action"] == "EARLY_PROBE"
    assert result["evidence"]["size_multiplier"] == .30
    assert result["evidence"]["shadow_only"] is True
    branches = assess_challenger_strategies(1, rows, market(), monthly_state="UP")
    assert [item["strategy_code"] for item in branches] == ["MACD_EARLY_ZONE", "SIDEWAY_RANGE"]
    assert branches[0]["action"] == "EARLY_PROBE"
    assert branches[0]["evidence"]["size_multiplier"] == .30
    assert branches[1]["action"] == "WATCH"
    blocked = assess_challenger_strategies(1, rows, market(), monthly_state="UP", champion_action="EXIT")
    assert blocked[0]["action"] == "WATCH"
    assert "CHAMPION_EXIT_CONFLICT" in blocked[0]["reasons"]


def test_far_stop_blocks_buy_without_changing_champion(monkeypatch):
    monkeypatch.setattr("protstock.challenger_engine.assess_macd_zone_divergence", lambda *_: [])
    result = assess_challenger(1, bars(), market(), "PROBE_BUY", ["BREAKOUT"], 9.0,
                               monthly_state="UP", base_price=9.8)
    assert result["action"] == "WATCH"
    assert "CHASE_BLOCKED" in result["reasons"]
    assert result["evidence"]["champion_action"] == "PROBE_BUY"
    assert result["distance_to_base_pct"] < result["evidence"]["distance_to_stop_pct"]


def test_sideway_breakout_is_rejected(monkeypatch):
    monkeypatch.setattr("protstock.challenger_engine.assess_macd_zone_divergence", lambda *_: [])
    rows = bars()
    rows[-1] = {**rows[-1], "close": 10.5, "high": 10.6}
    result = assess_challenger(1, rows, market("SIDEWAYS"), "PROBE_BUY", ["BREAKOUT"], 10.0, monthly_state="UP")
    assert result["action"] == "WATCH"
    assert "SIDEWAY_BREAKOUT_REJECTED" in result["reasons"]
    branches = assess_challenger_strategies(1, rows, market("SIDEWAYS"), monthly_state="UP")
    assert branches[1]["strategy_code"] == "SIDEWAY_RANGE"
    assert branches[1]["action"] == "WATCH"
    assert "SIDEWAY_BREAKOUT_REJECTED" in branches[1]["reasons"]


def test_sideway_spring_has_own_shadow_assessment(monkeypatch):
    monkeypatch.setattr("protstock.challenger_engine.assess_macd_zone_divergence", lambda *_: [])
    monkeypatch.setattr("protstock.challenger_engine.classify_wyckoff_timeframe", lambda *_args, **_kwargs: {
        "event": "SPRING_TEST", "evidence": {"support": 9.5}})
    branches = assess_challenger_strategies(1, bars(), market("SIDEWAYS"), monthly_state="UP")
    assert branches[1]["action"] == "PROBE_BUY"
    assert branches[1]["invalidation_price"] == 9.5
    assert branches[1]["evidence"]["shadow_only"] is True


def test_eod_shadow_writes_only_isolated_tables(monkeypatch):
    today = date(2026, 10, 6)
    rows = [{"date": day, "open": 10, "low": 9, "close": 10, "volume": 2_000_000}
            for day in ("2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06")]
    monkeypatch.setattr("protstock.eod.assess_challenger", lambda *args: {
        "symbol_id": 1, "trading_date": today.isoformat(), "engine_version": "v2.0-challenger",
        "action": "WATCH", "reasons": [], "evidence": {"shadow_only": True}})
    monkeypatch.setattr("protstock.eod.assess_challenger_strategies", lambda *args: [{
        "symbol_id": 1, "trading_date": today.isoformat(), "engine_version": "v2.0-challenger",
        "strategy_code": "MACD_EARLY_ZONE", "action": "WATCH", "reasons": [], "evidence": {"shadow_only": True}}])

    class Client:
        def __init__(self):
            self.writes = []

        def _pages(self, table, filters):
            if table == "consolidated_signals" and filters.get("as_of_date"):
                return [{"symbol_id": 1, "composite_action": "WATCH", "reasons": []}]
            if table == "consolidated_signals":
                return [{"symbol_id": 1, "as_of_date": "2026-10-01", "composite_action": "PROBE_BUY"}]
            if table == "challenger_signal_assessments":
                return [{"symbol_id": 1, "trading_date": "2026-10-01", "action": "EARLY_PROBE"}]
            if table == "challenger_strategy_assessments":
                return [{"symbol_id": 1, "trading_date": "2026-10-01", "strategy_code": "MACD_EARLY_ZONE",
                         "action": "EARLY_PROBE", "evidence": {"size_multiplier": .3}}]
            return []

        def upsert(self, table, payload, key):
            self.writes.append((table, payload, key))

    client = Client()
    counts, warnings = {}, []
    pending = [(1, "D", rows, [], {}, {"monthly_snapshot": {"trend_state": "UP"}})]
    _write_challenger_shadow(client, pending, market(), today, counts, warnings)
    assert warnings == []
    assert [table for table, *_ in client.writes] == ["challenger_signal_assessments",
                                                  "challenger_strategy_assessments",
                                                  "dual_engine_tplus_outcomes",
                                                  "challenger_strategy_tplus_outcomes"]
    assert counts["dual_engine_tplus_matured"] == 2
    assert counts["challenger_strategy_tplus_matured"] == 1
    assert {row["engine"] for row in client.writes[2][1]} == {"CHAMPION", "CHALLENGER"}
    assert all(row["net_return_pct"] < 0 for row in client.writes[2][1])
    assert client.writes[3][1][0]["size_multiplier"] == .3


def test_eod_shadow_failure_does_not_escape_to_champion():
    class Client:
        def _pages(self, *_args):
            raise RuntimeError("shadow schema unavailable")

        def upsert(self, *_args):
            raise AssertionError("must not write")

    warnings = []
    _write_challenger_shadow(Client(), [], {}, date(2026, 10, 6), {}, warnings)
    assert warnings == ["CHALLENGER_SHADOW_UNAVAILABLE:RuntimeError"]
