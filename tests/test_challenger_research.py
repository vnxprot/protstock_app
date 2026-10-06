from datetime import date, timedelta

from protstock.challenger_research import (assess_challenger, assess_challenger_strategies,
                                           early_second_low, market_regime, panic_spring, recovery_status)
from protstock.signal_funnel import assess_funnel


def bars(count=70):
    start = date(2026, 1, 1)
    return [{"date": (start + timedelta(days=i)).isoformat(), "open": 10.0,
             "high": 10.2, "low": 9.8, "close": 10.0, "volume": 2_000_000}
            for i in range(count)]


def context(trend="UP", breadth=60):
    return {"vnindex_snapshot": {"trend_state": trend},
            "breadth": {"pct_above_sma50": breadth, "coverage_status": "COMPLETE"}}


def test_early_macd_uses_current_closed_candle_without_future_pivot(monkeypatch):
    rows = bars()
    rows[40] = {**rows[40], "low": 9.5}
    rows[-1] = {**rows[-1], "open": 9.45, "low": 9.4, "high": 10.0, "close": 9.9}
    line = [-.5] * len(rows)
    line[40], line[-1] = -.8, -.2
    histogram = [-.1] * len(rows)
    histogram[-1] = .1
    monkeypatch.setattr("protstock.challenger_research._macd_series", lambda _: (line, histogram))
    monkeypatch.setattr("protstock.challenger_research._pivots", lambda _: [40])
    candidate = early_second_low(rows, 1)
    assert candidate["second_low_date"] == rows[-1]["date"]
    assert candidate["provisional_second_pivot"] is True
    assert candidate["stop"] < rows[-1]["low"]
    histogram[-1] = -.01
    assert early_second_low(rows, 1) is None


def test_downtrend_only_allows_oversold_early_probe(monkeypatch):
    rows = bars()
    monkeypatch.setattr("protstock.challenger_research.early_second_low", lambda *_: {
        "kind": "MACD_SECOND_LOW_CROSS", "base": 9.8, "stop": 9.7})
    monkeypatch.setattr("protstock.challenger_research.oversold_evidence", lambda *_: {"oversold": False})
    branches = assess_challenger_strategies(1, rows, context("DOWN", 20))
    assert all(item["action"] == "WATCH" for item in branches)
    assert "DOWNTREND_OVERSOLD_REQUIRED" in branches[3]["reasons"]
    monkeypatch.setattr("protstock.challenger_research.oversold_evidence", lambda *_: {"oversold": True})
    branches = assess_challenger_strategies(1, rows, context("DOWN", 20))
    assert branches[3]["action"] == "EARLY_PROBE"
    assert branches[3]["evidence"]["size_multiplier"] == .3
    assert branches[3]["evidence"]["max_portfolio_exposure_pct_downtrend"] == 20
    assert assess_challenger(1, rows, context("DOWN", 20))["action"] == "EARLY_PROBE"


def test_sideway_rejects_high_breakout_but_accepts_base_reversal():
    rows = bars()
    rows[-1] = {**rows[-1], "open": 10.1, "close": 10.5, "high": 10.6}
    rejected = assess_challenger_strategies(1, rows, context("SIDEWAYS"))[1]
    assert rejected["action"] == "WATCH"
    assert "SIDEWAY_BREAKOUT_REJECTED" in rejected["reasons"]
    rows[-1] = {**rows[-1], "open": 9.7, "low": 9.65, "close": 10.0}
    accepted = assess_challenger_strategies(1, rows, context("SIDEWAYS"))[1]
    assert accepted["action"] == "PROBE_BUY"
    assert accepted["evidence"]["candidate"]["target_return_pct_range"] == [7, 10]


def test_adaptive_funnel_is_separate_from_champion(monkeypatch):
    from protstock import signal_funnel
    rows = bars(250)
    monkeypatch.setattr(signal_funnel, "adaptive_monthly_context", lambda *_: {"state": "SIDEWAYS", "reasons": []})
    monkeypatch.setattr(signal_funnel, "monthly_context", lambda *_: {"state": "SIDEWAYS", "reasons": []})
    assert assess_funnel(1, rows)["stage"] == "MONTHLY_CONTEXT"
    adaptive = assess_funnel(1, rows, adaptive=True)
    assert adaptive["version"] != assess_funnel(1, rows)["version"]
    assert adaptive["stage"] != "MONTHLY_CONTEXT" or "WEEKLY_SETUP_MISSING" in adaptive["reasons"]


def test_ftd_requires_day_four_and_higher_volume():
    rows = bars(40)
    rows[-4] = {**rows[-4], "low": 8, "close": 8.2}
    rows[-3] = {**rows[-3], "close": 8.4}
    rows[-2] = {**rows[-2], "close": 8.5}
    rows[-1] = {**rows[-1], "close": 8.7, "volume": 3_000_000}
    assert recovery_status(rows)["state"] == "FTD_CONFIRMED"
    assert market_regime({**context("DOWN", 45), "recovery": recovery_status(rows)}) == "RECOVERY_FTD"


def test_downtrend_panic_spring_requires_high_volume_and_next_day_reclaim(monkeypatch):
    rows = bars()
    rows[-2] = {**rows[-2], "low": 9.5, "close": 9.6, "volume": 5_000_000}
    rows[-1] = {**rows[-1], "open": 9.7, "low": 9.6, "close": 10.0}
    setup = panic_spring(rows)
    assert setup["kind"] == "DOWNTREND_PANIC_SPRING"
    assert setup["sweep_volume_ratio20"] >= 2
    monkeypatch.setattr("protstock.challenger_research.oversold_evidence", lambda *_: {"oversold": True})
    branch = assess_challenger_strategies(1, rows, context("DOWN", 20))[4]
    assert branch["action"] == "PROBE_BUY"
    assert branch["evidence"]["size_multiplier"] == .3
    rows[-2]["volume"] = 1_000_000
    assert panic_spring(rows) is None
    assert assess_challenger_strategies(1, rows, context("DOWN", 20))[4]["action"] == "WATCH"
