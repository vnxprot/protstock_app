"""A confirmed structure is not a fresh breakout on every later close."""

from copy import deepcopy

from protstock.engines import evaluate_core_v1
from protstock.pattern_events import annotate_double_bottom_events, double_bottom_first_confirmation


def _bars():
    rows = [{"date": f"2026-09-{index + 1:02d}", "close": 12.0, "volume": 100} for index in range(24)]
    rows.extend([
        {"date": "2026-09-25", "close": 14.0, "volume": 200},
        {"date": "2026-09-28", "close": 14.1, "volume": 190},
    ])
    return rows


def _pattern():
    return {
        "pattern_type": "DOUBLE_BOTTOM", "state": "CONFIRMED", "direction": "BULLISH",
        "trigger_price": 13.4, "quality_score": 90,
        "evidence": {"second_pivot": 20},
        "reasons": ["TWO_CONFIRMED_PIVOTS", "NECKLINE_BREAK", "BREAKOUT_VOLUME"],
    }


def test_double_bottom_first_breakout_is_point_in_time():
    rows = _bars()
    assert double_bottom_first_confirmation(rows[:25], _pattern()) == "2026-09-25"
    assert double_bottom_first_confirmation(rows, _pattern()) == "2026-09-25"
    first = annotate_double_bottom_events(rows[:25], [deepcopy(_pattern())])[0]
    later = annotate_double_bottom_events(rows, [deepcopy(_pattern())])[0]
    assert first["confirmed_at"] == later["confirmed_at"] == "2026-09-25"
    assert first["evidence"]["new_confirmation"] is True
    assert later["evidence"]["new_confirmation"] is False
    assert "BREAKOUT_VOLUME" not in later["reasons"]
    assert "NECKLINE_BREAK" not in later["reasons"]


def test_core_v1_does_not_reissue_old_double_bottom():
    rows = _bars()
    context = {"snapshot": {"volume_ratio20": 1.9, "rsi14": 60}}
    first = annotate_double_bottom_events(rows[:25], [deepcopy(_pattern())])[0]
    later = annotate_double_bottom_events(rows, [deepcopy(_pattern())])[0]
    assert evaluate_core_v1({**context, "patterns": [first]})[:2] == (True, "PROBE_BUY")
    assert evaluate_core_v1({**context, "patterns": [later]})[0] is False
