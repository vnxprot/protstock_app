from datetime import date, timedelta

from protstock.classical_patterns import detect_classical_patterns
from protstock.engines import evaluate_named_engine
from protstock.signal_policy import apply_signal_policy
from protstock.wyckoff import classify_wyckoff


def _bar(index: int, close: float, *, low: float | None = None, high: float | None = None, volume: float = 100) -> dict:
    return {"date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(), "open": close - 0.4, "high": high if high is not None else close + 1, "low": low if low is not None else close - 1, "close": close, "volume": volume}


def test_cup_handle_requires_a_rim_breakout_with_volume() -> None:
    prior = [_bar(index, 80 + index * .8) for index in range(25)]
    cup_values = [100 - 15 * (index / 27) for index in range(28)] + [85 + 15 * (index / 26) for index in range(27)]
    cup = [_bar(25 + index, value) for index, value in enumerate(cup_values)]
    handle = [_bar(80 + index, 99 - index * .15) for index in range(10)]
    breakout = _bar(90, 103, high=104, low=101, volume=220)
    candidate = next(item for item in detect_classical_patterns([*prior, *cup, *handle, breakout]) if item["pattern_type"] == "CUP_HANDLE")
    assert candidate["state"] == "CONFIRMED"
    assert candidate["trigger_price"] > 100
    assert "BREAKOUT_VOLUME" in candidate["reasons"]


def test_wyckoff_only_classifies_decisive_spring_or_supply_break() -> None:
    range_bars = [_bar(index, 105, low=100, high=110) for index in range(50)]
    spring = classify_wyckoff([*range_bars, _bar(51, 101, low=98, high=103)])
    sow = classify_wyckoff([*range_bars, _bar(51, 98, low=97, high=100, volume=160)])
    assert (spring["state"], spring["event"]) == ("ACCUMULATION", "SPRING_TEST")
    assert (sow["state"], sow["event"]) == ("DISTRIBUTION", "SIGN_OF_WEAKNESS")
    passed, action, _ = evaluate_named_engine("wyckoff_context_v1", {}, {"wyckoff_context": spring})
    assert (passed, action) == (True, "WATCH")


def test_distribution_context_blocks_buy_but_not_as_a_standalone_sell() -> None:
    action, reasons = apply_signal_policy("PROBE_BUY", ["TEST"], {
        "data_date": "2026-09-15", "evaluation_date": "2026-09-15", "snapshot": {"close": 100, "atr14": 2},
        "daily_snapshot": {"close": 100, "volume_avg20": 5_000_000}, "market_context": {"breadth": {"coverage_status": "COMPLETE", "pct_above_sma50": 60}, "vnindex_snapshot": {"trend_state": "UP"}},
        "multi_timeframe_context": {"monthly_snapshot": {"trend_state": "UP"}}, "wyckoff_context": {"state": "DISTRIBUTION"}, "engine_evidence": {"invalidation_price": 95},
    })
    assert action == "WATCH"
    assert "WYCKOFF_DISTRIBUTION_CONTEXT" in reasons


def test_tplus_pullback_has_weekly_trend_and_short_horizon_evidence() -> None:
    closes = [110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 101.5]
    bars = [_bar(index, close, low=99.5 if index == len(closes) - 1 else close - 1) for index, close in enumerate(closes)]
    passed, action, reasons = evaluate_named_engine("tplus_pullback_v1", {}, {
        "bars": bars, "snapshot": {"ema20": 100, "sma20": 99, "sma50": 95, "volume_ratio20": 1.2},
        "multi_timeframe_context": {"weekly_snapshot": {"trend_state": "UP"}},
    })
    assert (passed, action) == (True, "PROBE_BUY")
    assert "TPLUS_TIME_STOP_8_SESSIONS" in reasons
