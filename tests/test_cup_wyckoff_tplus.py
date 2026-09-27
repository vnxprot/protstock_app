from datetime import date, timedelta

from protstock.classical_patterns import detect_classical_patterns
from protstock.engines import evaluate_named_engine
from protstock.signal_policy import apply_signal_policy
from protstock.wyckoff import classify_wyckoff, classify_wyckoff_timeframe


def _bar(index: int, close: float, *, low: float | None = None, high: float | None = None, volume: float = 100, open_price: float | None = None) -> dict:
    return {"date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(), "open": open_price if open_price is not None else close - 0.4, "high": high if high is not None else close + 1, "low": low if low is not None else close - 1, "close": close, "volume": volume}


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
    spring = classify_wyckoff([*range_bars, _bar(51, 102, low=98, high=103, volume=80), _bar(52, 103, low=100, high=105)])
    sow = classify_wyckoff([*range_bars, _bar(51, 98, low=97, high=102, volume=160, open_price=101), _bar(52, 97, low=96, high=100, open_price=99)])
    assert (spring["state"], spring["event"], spring["reasons"]) == ("BULLISH_CONTEXT", "SPRING_TEST", ["WYCKOFF_SPRING"])
    assert (sow["state"], sow["event"], sow["reasons"]) == ("BEARISH_CONTEXT", "SIGN_OF_WEAKNESS", ["WYCKOFF_SOW"])
    passed, action, _ = evaluate_named_engine("wyckoff_context_v1", {}, {"wyckoff_context": spring})
    assert (passed, action) == (True, "WATCH")


def test_wyckoff_rejects_weak_candles_and_labels_weekly_only_after_close() -> None:
    history = [_bar(index, 105, low=100, high=110) for index in range(50)]
    weak_spring = classify_wyckoff([*history, _bar(51, 101, low=98, high=103, volume=100), _bar(52, 103, low=100, high=105)])
    weak_sow = classify_wyckoff([*history, _bar(51, 98, low=97, high=102, volume=160, open_price=97), _bar(52, 97, low=96, high=100)])
    assert weak_spring["event"] is None
    assert weak_sow["event"] is None
    weekly = [{**bar, "is_complete": True} for bar in history]
    weekly.append({**_bar(51, 102, low=98, high=103, volume=80), "is_complete": True})
    weekly.append({**_bar(58, 103, low=101, high=105), "is_complete": True})
    weekly.append({**_bar(65, 104, low=102, high=106), "is_complete": False})
    assert classify_wyckoff_timeframe("W", weekly)["event"] is None
    result = classify_wyckoff_timeframe("W", weekly, period_event=True)
    assert result["event"] == "SPRING_TEST"
    assert result["evidence"]["timeframe"] == "W"
    assert result["evidence"]["event_date"] == weekly[-3]["date"]
    assert result["evidence"]["confirmed_on"] == weekly[-2]["date"]


def test_wyckoff_needs_follow_through_and_distinguishes_sos_from_utad() -> None:
    history = [_bar(index, 105, low=100, high=110) for index in range(50)]
    spring = _bar(51, 102, low=98, high=103, volume=80)
    assert classify_wyckoff([*history, spring, _bar(52, 99, low=97, high=103)])["event"] is None
    sos = classify_wyckoff([*history, _bar(51, 112, low=109, high=113, volume=160), _bar(52, 111, low=110, high=114)])
    utad = classify_wyckoff([*history, _bar(51, 107, low=105, high=112, volume=160, open_price=111), _bar(52, 106, low=104, high=109, open_price=108)])
    assert sos["reasons"] == ["WYCKOFF_SOS"]
    assert utad["reasons"] == ["WYCKOFF_UTAD"]


def test_distribution_context_blocks_buy_but_not_as_a_standalone_sell() -> None:
    action, reasons = apply_signal_policy("PROBE_BUY", ["TEST"], {
        "data_date": "2026-09-15", "evaluation_date": "2026-09-15", "snapshot": {"close": 100, "atr14": 2},
        "daily_snapshot": {"close": 100, "volume_avg20": 5_000_000}, "market_context": {"breadth": {"coverage_status": "COMPLETE", "pct_above_sma50": 60}, "vnindex_snapshot": {"trend_state": "UP"}},
        "multi_timeframe_context": {"monthly_snapshot": {"trend_state": "UP"}}, "wyckoff_context": {"state": "BEARISH_CONTEXT", "reasons": ["WYCKOFF_SOW"]}, "engine_evidence": {"invalidation_price": 95},
    })
    assert action == "WATCH"
    assert "WYCKOFF_DISTRIBUTION_CONTEXT" in reasons


def test_tplus_pullback_has_weekly_trend_and_short_horizon_evidence() -> None:
    bars = [_bar(index, 110, volume=150) for index in range(14)]
    bars.extend(_bar(14 + index, close, volume=100) for index, close in enumerate([106, 105, 104, 103, 102, 101, 100]))
    bars.append(_bar(21, 101.5, low=99.5, volume=165))
    passed, action, reasons = evaluate_named_engine("tplus_pullback_v1", {}, {
        "bars": bars, "snapshot": {"ema10": 100, "ema20": 99, "sma50": 95, "volume_ratio20": 1.2, "rsi14": 55, "atr14": 2},
        "multi_timeframe_context": {"weekly_snapshot": {"trend_state": "UP"}},
    })
    assert (passed, action) == (True, "PROBE_BUY")
    assert "TPLUS_TIME_STOP_5_TO_8_SESSIONS" in reasons
