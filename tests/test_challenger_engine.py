from datetime import date

from protstock.eod import _write_challenger_shadow


def test_eod_shadow_writes_only_isolated_tables(monkeypatch):
    today = date(2026, 10, 6)
    rows = [{"date": day, "open": 10, "low": 9, "close": 10, "volume": 2_000_000}
            for day in ("2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06")]
    monkeypatch.setattr("protstock.eod.assess_challenger", lambda *args: {
        "symbol_id": 1, "trading_date": today.isoformat(), "engine_version": "v2.0-challenger",
        "action": "WATCH", "reasons": [], "evidence": {"shadow_only": True}})
    monkeypatch.setattr("protstock.eod.assess_challenger_strategies", lambda *args: [{
        "symbol_id": 1, "trading_date": today.isoformat(), "engine_version": "v2.0-challenger",
        "strategy_code": code, "action": "WATCH", "reasons": [], "evidence": {"shadow_only": True}}
        for code in ("UPTREND_CORE", "SIDEWAY_RANGE", "ADAPTIVE_FUNNEL", "MACD_EARLY_ZONE", "DOWNTREND_SPRING")])

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
    _write_challenger_shadow(client, pending, {"vnindex_snapshot": {"trend_state": "UP"}}, today, counts, warnings)
    assert warnings == []
    assert [table for table, *_ in client.writes] == ["challenger_signal_assessments",
                                                  "challenger_strategy_assessments",
                                                  "dual_engine_tplus_outcomes",
                                                  "challenger_strategy_tplus_outcomes"]
    assert counts["dual_engine_tplus_matured"] == 2
    assert counts["challenger_strategy_tplus_matured"] == 1
    assert counts["challenger_shadow_expected"] == 1
    assert counts["challenger_status"] == "COMPLETE"
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
