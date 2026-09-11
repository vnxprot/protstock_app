from __future__ import annotations

from typing import Any

from .analysis import resolve_signal
from .rules import evaluate_rule, multi_timeframe_gate


def evaluate_named_engine(engine: str | None, overrides: dict[str, Any] | None, context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    """Evaluate a named Core Pack or preserve the existing custom DSL path.

    ``context`` is assembled from ``analyze_bars`` output by EOD. Engines only
    consume those values; they never recalculate indicators, patterns or zones.
    """
    overrides = overrides or {}
    if not engine or engine == "custom":
        passed, reasons = evaluate_rule(
            context["dsl"], context["snapshot"], context["bars"],
            context.get("patterns", ()), context.get("rule_context"),
        )
        return passed, context["dsl"].get("action", "WATCH"), reasons
    if engine == "core_ladder_v2":
        action, reasons = resolve_signal(
            context.get("patterns", []), context["snapshot"], context.get("position"),
            market_context=context.get("market_context"),
            multi_timeframe_context=context.get("multi_timeframe_context"),
            portfolio_positions=context.get("portfolio_positions"),
            candidate_sector=context.get("candidate_sector"),
            capital=context.get("capital"),
            **overrides,
        )
        reasons = [f"TREND_{context['snapshot'].get('trend_state', 'UNKNOWN')}", *reasons]
        meaningful = action != "WATCH" or any(reason.startswith("NEAR_TRIGGER_") for reason in reasons)
        return meaningful, action, reasons
    if engine == "core_ladder_v1":
        return evaluate_core_v1(context)
    if engine == "pullback_continuation_v1":
        return evaluate_pullback_continuation(context)
    raise ValueError(f"unknown signal engine: {engine}")


def evaluate_core_v1(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    """Consolidated equivalent of the four archived original Core v1 DSL rules."""
    snapshot = context["snapshot"]
    patterns = context.get("patterns", [])
    volume = float(snapshot.get("volume_ratio20") or 0)
    rsi = snapshot.get("rsi14")
    rsi_ok = rsi is not None and 40 <= float(rsi) <= 75

    if any(pattern.get("pattern_type") == "DOUBLE_TOP" and pattern.get("state") == "CONFIRMED" for pattern in patterns):
        return True, "REDUCE", ["CORE_V1_DOUBLE_TOP_CONFIRMED"]

    for pattern_type, minimum_volume in (("ACCUMULATION_BASE", 1.5), ("DOUBLE_BOTTOM", 1.3)):
        if any(pattern.get("pattern_type") == pattern_type and pattern.get("state") == "CONFIRMED" for pattern in patterns) and volume > minimum_volume and rsi_ok:
            reasons = [f"CORE_V1_{pattern_type}_CONFIRMED", "VOLUME_CONFIRMED", "RSI_OK"]
            if context.get("multi_timeframe_context") is not None:
                ok, gate_reasons = multi_timeframe_gate(context["multi_timeframe_context"])
                reasons.extend(gate_reasons)
                if not ok:
                    return True, "WATCH", reasons
            return True, "PROBE_BUY", reasons

    if any(pattern.get("pattern_type") == "ASCENDING_TRIANGLE" and pattern.get("state") == "READY" for pattern in patterns):
        return True, "WATCH", ["CORE_V1_ASCENDING_TRIANGLE_READY"]
    return False, "WATCH", []


def evaluate_pullback_continuation(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    """Signal the dedicated pullback pack without changing the Core v2 ladder."""
    pattern = next((item for item in context.get("patterns", []) if item.get("pattern_type") == "PULLBACK_CONTINUATION" and item.get("state") == "CONFIRMED"), None)
    if pattern is None:
        return False, "WATCH", []
    reasons = ["PATTERN_PULLBACK_CONTINUATION_CONFIRMED", *(pattern.get("reasons") or [])]
    if context.get("multi_timeframe_context") is not None:
        ok, gate_reasons = multi_timeframe_gate(context["multi_timeframe_context"])
        reasons.extend(gate_reasons)
        if not ok:
            return True, "WATCH", reasons
    return True, "PROBE_BUY", reasons
