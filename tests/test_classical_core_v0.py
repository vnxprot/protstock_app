from datetime import date, timedelta

from protstock.classical_patterns import detect_classical_patterns
from protstock.engines import evaluate_classical_patterns_v0
from protstock.resolution import resolve_consolidated_signal


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
