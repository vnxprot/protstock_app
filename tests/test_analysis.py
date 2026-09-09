from datetime import date, timedelta

from protstock.analysis import analyze_bars
from protstock.indicators import calculate_indicators
from protstock.patterns import detect_double


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
    assert result["algorithm_version"] == "phase2.1"
    assert result["reasons"][0] == "TREND_UP"
    assert result["signal_preview"] in {"WATCH", "PROBE_BUY", "REDUCE"}


def test_double_bottom_requires_neckline_break() -> None:
    bars = make_bars(40, 0)
    for index, close in enumerate([22, 21, 20, 19, 18, 19, 21, 23, 21, 19, 18.2, 19, 21, 24]):
        offset = 20 + index
        bars[offset].update(open=close, high=close + 0.5, low=close - 0.5, close=close)
    candidate = detect_double(bars, "bottom")
    assert candidate is not None
    assert candidate.pattern_type == "DOUBLE_BOTTOM"
    assert candidate.state in {"READY", "CONFIRMED"}

