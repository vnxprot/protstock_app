from datetime import date, timedelta

from protstock.classical_patterns import detect_classical_patterns
from protstock.engines import evaluate_classical_patterns_v0
from protstock.resolution import resolve_consolidated_signal
from protstock.flag_geometry import detect_flag_structure
from protstock.patterns import detect_flag


def _bar(index: int, close: float, volume: float, high: float | None = None, low: float | None = None) -> dict:
    return {
        "date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(),
        "open": close - .5, "high": high if high is not None else close + 1,
        "low": low if low is not None else close - 1, "close": close, "volume": volume,
    }


def _snapshot() -> dict:
    return {"close": 122, "trend_state": "UP", "volume_ratio20": 2, "volume_avg20": 5_000_000, "rsi14": 55, "ma_stack": True}


def _flat_base() -> dict:
    return {"model": "flat_base", "pattern_type": "FLAT_BASE_BREAKOUT", "direction": "BULLISH", "state": "CONFIRMED", "quality_score": 80, "trigger_price": 120, "invalidation_price": 111, "reasons": ["TIGHT_FLAT_BASE", "BREAKOUT_VOLUME"], "evidence": {}}


def test_flat_base_detector_requires_prior_strength_and_confirmed_breakout() -> None:
    bars = [_bar(index, 100 + index * .8, 160) for index in range(20)]
    bars += [_bar(index, 116, 100, high=120, low=112) for index in range(20, 40)]
    bars.append(_bar(40, 122, 240, high=123, low=119))
    candidates = detect_classical_patterns(bars, {"trend_state": "UP"})
    candidate = next(item for item in candidates if item["model"] == "flat_base")
    assert candidate["state"] == "CONFIRMED"
    assert candidate["trigger_price"] == 120
    assert candidate["evidence"]["volume_ratio20"] > 1.3


def test_v0_respects_child_model_toggle_and_preserves_evidence() -> None:
    context = {"bars": [], "snapshot": _snapshot(), "classical_patterns": [_flat_base()]}
    passed, action, reasons = evaluate_classical_patterns_v0(context)
    assert (passed, action) == (True, "PROBE_BUY")
    assert reasons[0] == "V0_FLAT_BASE_BREAKOUT_CONFIRMED"
    assert context["engine_evidence"]["evidence_cluster"] == "FLAT_BASE_BREAKOUT"

    disabled = {"bars": [], "snapshot": _snapshot(), "classical_patterns": [_flat_base()]}
    assert evaluate_classical_patterns_v0(disabled, {"models": {"flat_base": False}}) == (False, "WATCH", [])


def test_v0_bearish_pattern_reduces_only_when_position_exists() -> None:
    top = {"model": "double_top", "pattern_type": "DOUBLE_TOP", "direction": "BEARISH", "state": "CONFIRMED", "quality_score": 82, "trigger_price": 95, "invalidation_price": 110, "reasons": ["BREAKOUT_VOLUME"], "evidence": {}}
    no_position = {"bars": [], "snapshot": _snapshot(), "classical_patterns": [top]}
    held = {"bars": [], "snapshot": _snapshot(), "position": {"quantity": 100}, "classical_patterns": [top]}
    assert evaluate_classical_patterns_v0(no_position)[0:2] == (True, "WATCH")
    assert evaluate_classical_patterns_v0(held)[0:2] == (True, "REDUCE")


def test_same_pattern_cluster_is_not_counted_as_two_independent_votes() -> None:
    result = resolve_consolidated_signal([
        {"action": "PROBE_BUY", "engine": "Prot Core Engine v0.0", "evidence": {"evidence_cluster": "DOUBLE_BOTTOM"}, "reasons": ["V0_DOUBLE_BOTTOM_CONFIRMED"]},
        {"action": "PROBE_BUY", "engine": "Prot Core Engine v2.0", "evidence": {"evidence_cluster": "DOUBLE_BOTTOM"}, "reasons": ["PATTERN_DOUBLE_BOTTOM_CONFIRMED"]},
    ])
    assert (result["confluence_count"], result["confluence_score"]) == (1, 70)
    assert result["consensus_engines"] == ["Prot Core Engine v0.0", "Prot Core Engine v2.0"]


def test_duplicate_flag_confirmations_share_one_concise_reason() -> None:
    result = resolve_consolidated_signal([
        {"action": "PROBE_BUY", "engine": "V0", "evidence": {"evidence_cluster": "BULL_FLAG"}, "reasons": ["V0_BULL_FLAG_CONFIRMED", "IMPULSE_POLE"]},
        {"action": "PROBE_BUY", "engine": "Core", "evidence": {"evidence_cluster": "BULL_FLAG"}, "reasons": ["PATTERN_BULL_FLAG_CONFIRMED", "IMPULSE_POLE"]},
    ])
    assert result["confluence_count"] == 1
    assert result["reasons"] == ["IMPULSE_POLE", "PATTERN_BULL_FLAG_CONFIRMED"]


def test_msb_wide_weekly_base_is_not_forced_into_a_bull_flag() -> None:
    # KBS weekly OHLCV from 20 April through 25 September 2026; prices in kVND.
    values = [
        (10.555, 10.764, 10.346, 10.513, 60.30),
        (10.513, 10.555, 10.430, 10.430, 9.13),
        (10.472, 11.431, 10.430, 11.264, 76.18),
        (11.348, 11.598, 11.056, 11.598, 79.14),
        (11.515, 12.057, 11.348, 12.015, 106.46),
        (11.974, 12.766, 11.890, 12.766, 118.50),
        (12.474, 12.516, 11.807, 12.349, 55.96),
        (12.266, 12.641, 11.807, 12.516, 50.84),
        (12.683, 13.267, 12.558, 13.183, 70.86),
        (13.058, 13.267, 12.891, 13.267, 32.63),
        (13.267, 13.517, 13.183, 13.350, 38.87),
        (13.350, 13.475, 13.058, 13.183, 26.75),
        (13.183, 13.726, 12.891, 13.642, 43.09),
        (13.559, 13.601, 12.808, 13.309, 44.57),
        (13.309, 13.434, 12.933, 13.309, 26.98),
        (13.434, 13.601, 13.309, 13.517, 30.18),
        (13.517, 13.601, 13.309, 13.475, 32.83),
        (13.475, 13.475, 12.975, 13.267, 20.79),
        (13.309, 13.350, 12.140, 13.350, 39.17),
        (13.350, 13.400, 13.150, 13.150, 7.58),
        (13.150, 13.200, 12.700, 12.950, 12.67),
        (12.800, 13.250, 12.650, 12.900, 17.97),
        (13.200, 14.500, 13.000, 14.050, 83.09),
    ]
    rows = [{"date": (date(2026, 4, 20) + timedelta(weeks=index)).isoformat(),
             "open": open_, "high": high, "low": low, "close": close, "volume": volume * 1_000_000}
            for index, (open_, high, low, close, volume) in enumerate(values)]
    assert detect_flag_structure(rows) is None
    assert detect_flag(rows) is None
    assert not any(candidate["model"] == "flag_pennant" for candidate in detect_classical_patterns(rows))
