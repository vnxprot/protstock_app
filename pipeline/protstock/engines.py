from __future__ import annotations

from typing import Any

from .analysis import resolve_signal
from .classical_patterns import MODEL_LABELS, detect_classical_patterns
from .fibonacci import enrich_pattern_fibonacci, matching_fibonacci
from .rules import evaluate_rule, multi_timeframe_gate
from .divergence import evaluate_rsi_macd_confirmation


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
    "wyckoff_context_v1": {
        "name": "Wyckoff Context Pack",
        "target_engine": "all",
        "description": "Đọc Spring/SOS và UTAD/SOW làm bối cảnh cung–cầu; không tự phát lệnh mua",
    },
    "tplus_pullback_v1": {
        "name": "T+ Pullback Pack",
        "target_engine": "core_ladder_v2",
        "description": "Hồi 3–7 phiên trong xu hướng tuần tăng, xác nhận nến và volume ngày",
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
        meaningful = action != "WATCH" or len(reasons) > 1
        matches = [match for pattern in context.get("patterns", []) if "FIB_CONFLUENCE" in pattern.get("reasons", []) for match in (pattern.get("evidence") or {}).get("fibonacci", [])]
        if "FIB_CONFLUENCE" in reasons and matches:
            context["engine_evidence"] = {**(context.get("engine_evidence") or {}), "fibonacci": matches}
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
    if engine == "rsi_macd_confirmation_v1_1":
        return evaluate_rsi_macd_confirmation(context)
    if engine == "relative_strength_leader_v1":
        return evaluate_relative_strength_leader_v1(context)
    if engine == "wyckoff_context_v1":
        return evaluate_wyckoff_context_v1(context)
    if engine == "tplus_pullback_v1":
        return evaluate_tplus_pullback_v1(context)
    raise ValueError(f"unknown signal engine: {engine}")


def evaluate_classical_patterns_v0(context: dict[str, Any], overrides: dict[str, Any] | None = None) -> tuple[bool, str, list[str]]:
    """Evaluate the strict, research-first six-family classical engine.

    One strongest valid candidate is selected so a single chart structure never
    becomes several independent votes in the consolidated signal resolver.
    """
    overrides = overrides or {}
    enabled_models = {
        "flat_base": True, "flag_pennant": True, "double_bottom": True,
        "double_top": True, "head_shoulders": True, "cup_handle": True,
        **(overrides.get("models") or {}),
    }
    candidates = context.get("classical_patterns") or detect_classical_patterns(
        context.get("bars", []), context.get("snapshot", {}),
    )
    candidates = [candidate for candidate in candidates if enabled_models.get(candidate["model"], True) and candidate.get("pattern_type") != "ROUNDING_BOTTOM"]
    candidates = [enrich_pattern_fibonacci(candidate, context.get("fibonacci_context") or {}, context.get("zones", [])) for candidate in candidates]
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

    ready = [candidate for candidate in candidates if candidate["state"] == "READY" and candidate.get("pattern_type") == "CUP_HANDLE" and candidate.get("quality_score", 0) >= 70]
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
    reasons = ["PULLBACK_EMA20_OR_SMA50", "LOW_VOLUME_PULLBACK", "BULLISH_REVERSAL", "MONTHLY_UP", "WEEKLY_UP"]
    matches = matching_fibonacci(float(bar["close"]), context.get("fibonacci_context") or {}, context.get("zones", []), pullback=True)
    if matches:
        reasons.append("FIB_CONFLUENCE")
        context["engine_evidence"] = {**(context.get("engine_evidence") or {}), "fibonacci": matches}
    return True, "PROBE_BUY", reasons


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


def evaluate_wyckoff_context_v1(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    """Persist decisive supply/demand evidence as WATCH only, never a buy vote."""
    wyckoff = context.get("wyckoff_context") or {}
    if not wyckoff.get("event"):
        return False, "WATCH", []
    context["engine_evidence"] = {"wyckoff": wyckoff}
    return True, "WATCH", list(wyckoff.get("reasons") or [])


def evaluate_tplus_pullback_v1(context: dict[str, Any]) -> tuple[bool, str, list[str]]:
    """Strict T+ continuation setup; never a generic oversold-bounce call."""
    bars, snapshot = context.get("bars", []), context.get("snapshot", {})
    weekly = (context.get("multi_timeframe_context") or {}).get("weekly_snapshot") or {}
    weekly_healthy = weekly.get("trend_state") == "UP" or (
        weekly.get("trend_state") == "SIDEWAYS" and weekly.get("ema20") is not None
        and float(weekly.get("close") or 0) >= float(weekly["ema20"])
    )
    if len(bars) < 22 or not weekly_healthy:
        return False, "WATCH", []
    pullback = bars[-8:-1]
    declines = sum(float(pullback[index]["close"]) < float(pullback[index - 1]["close"]) for index in range(1, len(pullback)))
    last = bars[-1]
    support = next((float(value) for value in (snapshot.get("ema10"), snapshot.get("ema20"), snapshot.get("sma50")) if value is not None and float(last["low"]) <= float(value) <= float(last["high"])), None)
    reversal = float(last["close"]) > float(last["open"]) and float(last["close"]) > float(bars[-2]["close"])
    pullback_volume = sum(float(row.get("volume") or 0) for row in pullback) / len(pullback)
    prior_volume = sum(float(row.get("volume") or 0) for row in bars[-15:-8]) / 7
    volume_contracted = prior_volume > 0 and pullback_volume <= prior_volume * .9
    volume_ok = float(snapshot.get("volume_ratio20") or 0) >= 1.1
    rsi = snapshot.get("rsi14")
    rsi_healthy = rsi is not None and 45 <= float(rsi) <= 72
    if not (3 <= declines <= 7 and support is not None and reversal and volume_contracted and volume_ok and rsi_healthy):
        return False, "WATCH", []
    atr = float(snapshot.get("atr14") or 0)
    stop = max(0.01, min(float(row["low"]) for row in pullback) - atr * .1)
    context["engine_evidence"] = {"pattern_type": "TPLUS_PULLBACK", "trigger_price": float(last["high"]), "invalidation_price": stop, "setup_expiry_sessions": 3, "time_stop_sessions": 8, "partial_take_profit_r": 1.0, "evidence_cluster": "TPLUS_PULLBACK"}
    return True, "PROBE_BUY", ["TPLUS_PULLBACK_3_TO_7_SESSIONS", "WEEKLY_HEALTHY", "EMA10_EMA20_OR_SMA50_SUPPORT", "PULLBACK_VOLUME_CONTRACTION", "RSI_STRUCTURE_INTACT", "BULLISH_DAILY_TRIGGER", "VOLUME_TRIGGER_GE_1_1X", "MARKET_RISK_POLICY_REQUIRED", "TPLUS_ENTRY_EXPIRES_3_SESSIONS", "TPLUS_TIME_STOP_5_TO_8_SESSIONS", "PARTIAL_TAKE_PROFIT_1R_OR_RESISTANCE"]


def _high(bars: list[dict]) -> float:
    return max(float(item["high"]) for item in bars)


def _low(bars: list[dict]) -> float:
    return min(float(item["low"]) for item in bars)
