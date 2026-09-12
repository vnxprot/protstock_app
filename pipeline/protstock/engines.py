from __future__ import annotations

from typing import Any

from .analysis import resolve_signal
from .classical_patterns import MODEL_LABELS, detect_classical_patterns
from .rules import evaluate_rule, multi_timeframe_gate


CORE_PACK_METADATA = {
    "pullback_continuation_v1": {
        "name": "Pullback Continuation Pack",
        "target_engine": "core_ladder_v2",
        "description": "Bắt nến rủ bỏ hồi phục về EMA20/SMA50 trong Up-trend",
    },
    "vcp_breakout_v1": {
        "name": "VCP Volatility Contraction Pack",
        "target_engine": "core_ladder_v2",
        "description": "Bắt mẫu hình nén biến động Mark Minervini siết chặt volume",
    },
    "rsi_macd_divergence_v1": {
        "name": "RSI / MACD Divergence Pack",
        "target_engine": "core_ladder_v2",
        "description": "Bắt điểm xoay chiều phân kỳ dương đảo chiều tại S/R Zone",
    },
    "relative_strength_leader_v1": {
        "name": "Relative Strength Leader Pack",
        "target_engine": "core_ladder_v2",
        "description": "Bắt siêu cổ phiếu giữ nền giá mạnh hơn VNIndex",
    },
}


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
    if engine == "classical_patterns_v0":
        return evaluate_classical_patterns_v0(context, overrides)
    if engine == "pullback_continuation_v1":
        return evaluate_pullback_continuation_v1(context)
    if engine == "vcp_breakout_v1":
        return evaluate_vcp_breakout_v1(context)
    if engine == "rsi_macd_divergence_v1":
        return evaluate_rsi_macd_divergence_v1(context)
    if engine == "relative_strength_leader_v1":
        return evaluate_relative_strength_leader_v1(context)
    raise ValueError(f"unknown signal engine: {engine}")


def evaluate_classical_patterns_v0(context: dict[str, Any], overrides: dict[str, Any] | None = None) -> tuple[bool, str, list[str]]:
    """Evaluate the strict, research-first five-family classical engine.

    One strongest valid candidate is selected so a single chart structure never
    becomes several independent votes in the consolidated signal resolver.
    """
    overrides = overrides or {}
    enabled_models = {
        "flat_base": True, "flag_pennant": True, "double_bottom": True,
        "double_top": True, "head_shoulders": True,
        **(overrides.get("models") or {}),
    }
    candidates = context.get("classical_patterns") or detect_classical_patterns(
        context.get("bars", []), context.get("snapshot", {}),
    )
    candidates = [candidate for candidate in candidates if enabled_models.get(candidate["model"], True)]
    snapshot = context.get("snapshot", {})
    position = context.get("position")
    confirmed = [candidate for candidate in candidates if candidate["state"] == "CONFIRMED"]
    bears = [candidate for candidate in confirmed if candidate["direction"] == "BEARISH" and candidate["quality_score"] >= 75]
    if bears:
        top = max(bears, key=lambda candidate: candidate["quality_score"])
        _attach_v0_evidence(context, top)
        return True, "REDUCE" if position else "WATCH", [f"V0_{top['pattern_type']}_CONFIRMED", *top["reasons"]]

    threshold = {"DOUBLE_BOTTOM": 80, "INVERSE_HEAD_SHOULDERS": 80}
    bulls = [candidate for candidate in confirmed if candidate["direction"] == "BULLISH" and candidate["quality_score"] >= threshold.get(candidate["pattern_type"], 75)]
    if bulls:
        top = max(bulls, key=lambda candidate: candidate["quality_score"])
        _attach_v0_evidence(context, top)
        action, gate_reasons = resolve_signal(
            [top], snapshot, position,
            market_context=context.get("market_context"),
            multi_timeframe_context=context.get("multi_timeframe_context"),
            portfolio_positions=context.get("portfolio_positions"),
            candidate_sector=context.get("candidate_sector"), capital=context.get("capital"),
        )
        return True, action, [f"V0_{top['pattern_type']}_CONFIRMED", *top["reasons"], *gate_reasons]

    ready = [candidate for candidate in candidates if candidate["state"] == "READY"]
    if ready:
        top = max(ready, key=lambda candidate: candidate["quality_score"])
        _attach_v0_evidence(context, top)
        return True, "WATCH", [f"V0_NEAR_{top['pattern_type']}", *top["reasons"]]
    return False, "WATCH", []


def _attach_v0_evidence(context: dict[str, Any], candidate: dict[str, Any]) -> None:
    context["engine_evidence"] = {
        "engine_version": "v0.0", "model": candidate["model"],
        "model_label": MODEL_LABELS[candidate["model"]], "pattern_type": candidate["pattern_type"],
        "quality_score": candidate["quality_score"], "trigger_price": candidate["trigger_price"],
        "invalidation_price": candidate["invalidation_price"],
        "evidence_cluster": candidate["pattern_type"],
        "pattern_evidence": candidate["evidence"],
    }

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


def evaluate_pullback_continuation_v1(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    """Daily reversal at EMA20/SMA50, aligned with monthly and weekly uptrends."""
    bars, snapshot = context.get("bars", []), context.get("snapshot", {})
    # Legacy callers supplied the detector's already-confirmed evidence only.
    # EOD always supplies bars and therefore always follows the stricter path below.
    if not bars:
        pattern = next((item for item in context.get("patterns", []) if item.get("pattern_type") == "PULLBACK_CONTINUATION" and item.get("state") == "CONFIRMED"), None)
        if pattern is not None:
            return True, "PROBE_BUY", ["PATTERN_PULLBACK_CONTINUATION_CONFIRMED", *(pattern.get("reasons") or [])]
    mtf = context.get("multi_timeframe_context") or {}
    monthly_up = (mtf.get("monthly_snapshot") or {}).get("trend_state") == "UP"
    weekly_up = (mtf.get("weekly_snapshot") or {}).get("trend_state") == "UP"
    if not bars or not monthly_up or not weekly_up or (snapshot.get("volume_ratio20") or 1) >= 1:
        return False, "WATCH", []
    bar = bars[-1]
    touched = any(value is not None and float(bar["low"]) <= float(value) <= float(bar["high"]) for value in (snapshot.get("ema20"), snapshot.get("sma50")))
    reversal = float(bar["close"]) > float(bar["open"])
    if not touched or not reversal:
        return False, "WATCH", []
    return True, "PROBE_BUY", ["PULLBACK_EMA20_OR_SMA50", "LOW_VOLUME_PULLBACK", "BULLISH_REVERSAL", "MONTHLY_UP", "WEEKLY_UP"]


def evaluate_pullback_continuation(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    """Compatibility alias for callers of the pre-Phase-2 function name."""
    return evaluate_pullback_continuation_v1(context)


def evaluate_vcp_breakout_v1(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    bars, snapshot = context.get("bars", []), context.get("snapshot", {})
    if len(bars) < 31 or (snapshot.get("volume_ratio20") or 0) <= 1.5:
        return False, "WATCH", []
    windows = (bars[-31:-21], bars[-21:-11], bars[-11:-1])
    depths = [(_high(window) - _low(window)) / _high(window) for window in windows]
    baseline = sum(float(item.get("volume", 0)) for item in bars[-24:-4]) / 20
    dry_up = baseline > 0 and sum(float(item.get("volume", 0)) for item in bars[-4:-1]) / 3 < baseline * 0.7
    breakout = float(bars[-1]["close"]) > max(float(item["high"]) for item in bars[-11:-1])
    if not (depths[2] < depths[1] < depths[0] and dry_up and breakout):
        return False, "WATCH", []
    return True, "PROBE_BUY", ["VCP_DEPTH_CONTRACTING", "VCP_VOLUME_DRY_UP", "VCP_BREAKOUT_VOLUME"]


def evaluate_rsi_macd_divergence_v1(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    bars, snapshot, zones = context.get("bars", []), context.get("snapshot", {}), context.get("zones", [])
    if len(bars) < 21 or snapshot.get("rsi14") is None:
        return False, "WATCH", []
    current = bars[-1]
    prior_slice = bars[-16:-4]
    prior_low_index = min(range(len(prior_slice)), key=lambda index: float(prior_slice[index]["low"]))
    prior_bars = bars[:len(bars) - 16 + prior_low_index + 1]
    from .indicators import calculate_indicators
    prior_rsi = calculate_indicators(prior_bars).rsi14
    new_price_low = float(current["low"]) < min(float(item["low"]) for item in prior_slice)
    bullish_rsi = prior_rsi is not None and float(snapshot["rsi14"]) > float(prior_rsi)
    in_support = any(zone.get("zone_type") == "SUPPORT" and float(zone.get("strength") or 0) >= 60 and float(zone.get("lower_price") or 0) <= float(current["low"]) <= float(zone.get("upper_price") or 0) for zone in zones)
    if not (new_price_low and bullish_rsi and in_support):
        return False, "WATCH", []
    return True, "PROBE_BUY", ["BULLISH_RSI_DIVERGENCE", "SUPPORT_ZONE_STRONG"]


def evaluate_relative_strength_leader_v1(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    snapshot = context.get("snapshot", {})
    market = (context.get("market_context") or {}).get("vnindex_snapshot") or {}
    rs = snapshot.get("relative_strength_market")
    if snapshot.get("trend_state") != "UP" or rs is None or float(rs) <= 0.05 or market.get("trend_state") not in {"SIDEWAYS", "DOWN"}:
        return False, "WATCH", []
    return True, "PROBE_BUY", ["RELATIVE_STRENGTH_GT_5PCT", f"VNINDEX_{market['trend_state']}", "STOCK_UPTREND"]


def _high(bars: list[dict]) -> float:
    return max(float(item["high"]) for item in bars)


def _low(bars: list[dict]) -> float:
    return min(float(item["low"]) for item in bars)
