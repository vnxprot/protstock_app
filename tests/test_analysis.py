from datetime import date, timedelta

from protstock.analysis import analyze_bars, resolve_signal
from protstock.indicators import calculate_indicators
from protstock.patterns import detect_double, detect_flag, detect_triangle
from protstock.timeframes import aggregate_bars


def make_bars(count: int = 220, drift: float = 0.12) -> list[dict]:
    start = date(2025, 1, 1)
    bars = []
    price = 20.0
    for index in range(count):
        price += drift + ((index % 7) - 3) * 0.015
        bars.append({
            "date": (start + timedelta(days=index)).isoformat(),
            "open": price - 0.08,
            "high": price + 0.25,
            "low": price - 0.25,
            "close": price,
            "volume": 1_000_000 + index * 1_000,
        })
    return bars


def test_indicator_snapshot_has_full_long_term_context() -> None:
    snapshot = calculate_indicators(make_bars())
    assert snapshot.sma200 is not None
    assert snapshot.atr14 is not None
    assert snapshot.rsi14 is not None
    assert snapshot.trend_state == "UP"


def test_analysis_is_explainable() -> None:
    result = analyze_bars(make_bars())
    assert result["algorithm_version"] == "core-rules-v2"
    assert result["reasons"][0] == "TREND_UP"
    assert result["signal_preview"] in {"WATCH", "PROBE_BUY", "ADD", "REDUCE", "EXIT"}


def test_double_bottom_requires_neckline_break() -> None:
    bars = make_bars(40, 0)
    for index, close in enumerate([22, 21, 20, 19, 18, 19, 21, 23, 21, 19, 18.2, 19, 21, 24]):
        offset = 20 + index
        bars[offset].update(open=close, high=close + 0.5, low=close - 0.5, close=close)
    candidate = detect_double(bars, "bottom")
    assert candidate is not None
    assert candidate.pattern_type == "DOUBLE_BOTTOM"
    assert candidate.state in {"READY", "CONFIRMED"}
    assert {"base_length_score", "volatility_tightness_score", "boundary_tests_score", "volume_contraction_score", "breakout_confirmation_score"} <= candidate.evidence.keys()


def _snapshot(close=100):
    return {"close": close, "trend_state": "UP", "volume_ratio20": 2, "volume_avg20": 5_000_000, "rsi14": 50, "atr14": 2}


def _bull(start_date="2025-01-10", score=75):
    return {"pattern_type": "DOUBLE_BOTTOM", "direction": "BULLISH", "state": "CONFIRMED", "quality_score": score, "start_date": start_date, "invalidation_price": 96}


def test_exit_short_circuits_bullish_pattern():
    assert resolve_signal([_bull()], _snapshot(90), {"entry_date": "5", "invalidation_price": 95}) == ("EXIT", ["INVALIDATION_BROKEN"])


def test_add_requires_new_structure_after_entry():
    assert resolve_signal([_bull("2025-01-10")], _snapshot(), {"entry_date": "2025-01-05", "invalidation_price": 90})[0] == "ADD"
    assert resolve_signal([_bull("2025-01-03")], _snapshot(), {"entry_date": "2025-01-05", "invalidation_price": 90})[0] == "WATCH"


def test_core_signal_mtf_gate_downgrades_buy():
    result = analyze_bars(make_bars(), weekly_patterns=[], monthly_snapshot={"trend_state": "UP"})
    assert result["signal_preview"] == "WATCH"


def _bar(open_, high, low, close, volume=100):
    return {"date": "2025-01-01", "open": open_, "high": high, "low": low, "close": close, "volume": volume}


def _triangle_bars(volume=100):
    bars = [_bar(99, 101, 90 + i * .6, 99, volume) for i in range(39)]
    bars.append(_bar(100, 103, 100, 102, volume))
    return bars


def _flag_bars(volume=100):
    pole = [_bar(100 + i * 1.5, 102 + i * 1.5, 99 + i * 1.5, 101.5 + i * 1.5, volume) for i in range(10)]
    flag = [_bar(115 - i * .7, 116 - i * .7, 113 - i * .7, 114 - i * .7, volume) for i in range(10)]
    return pole + flag + [_bar(104, 118, 103, 117, volume)]


def test_triangle_price_break_without_volume_stays_ready():
    candidate = detect_triangle(_triangle_bars())
    assert candidate is not None and candidate.state == "READY"
    assert candidate.evidence["breakout_volume_ok"] is False
    assert "NEEDS_VOLUME_CONFIRMATION" in candidate.reasons


def test_triangle_price_break_with_volume_confirms():
    bars = _triangle_bars(); bars[-1]["volume"] = 200
    candidate = detect_triangle(bars)
    assert candidate is not None and candidate.state == "CONFIRMED"
    assert candidate.evidence["breakout_volume_ok"] is True


def test_flag_price_break_without_volume_stays_ready():
    candidate = detect_flag(_flag_bars())
    assert candidate is not None and candidate.state == "READY"
    assert candidate.evidence["breakout_volume_ok"] is False
    assert "NEEDS_VOLUME_CONFIRMATION" in candidate.reasons


def test_flag_price_break_with_volume_confirms():
    bars = _flag_bars(); bars[-1]["volume"] = 200
    candidate = detect_flag(bars)
    assert candidate is not None and candidate.state == "CONFIRMED"
    assert candidate.evidence["breakout_volume_ok"] is True


def test_weekly_and_monthly_aggregation_preserves_ohlcv() -> None:
    bars = make_bars(40)
    weekly = aggregate_bars(bars, "W")
    monthly = aggregate_bars(bars, "M")
    assert sum(bar["volume"] for bar in weekly) == sum(bar["volume"] for bar in bars)
    assert weekly[0]["open"] == bars[0]["open"]
    assert weekly[-1]["close"] == bars[-1]["close"]
    assert monthly[0]["high"] == max(bar["high"] for bar in bars[:31])
    assert weekly[-1]["is_complete"] is False
