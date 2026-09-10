from __future__ import annotations

from typing import Sequence

from .indicators import calculate_indicators
from .patterns import detect_patterns
from .rules import multi_timeframe_gate
from .risk import invalidation_width_warning


ALGORITHM_VERSION = "core-rules-v2"


def analyze_bars(bars: Sequence[dict], position: dict | None = None, weekly_patterns: list[dict] | None = None, monthly_snapshot: dict | None = None) -> dict:
    if not bars:
        raise ValueError("bars cannot be empty")
    ordered = sorted(bars, key=lambda item: item["date"])
    snapshot = calculate_indicators(ordered)
    patterns = detect_patterns(ordered)
    signal, reasons = resolve_signal([item.to_dict() for item in patterns], snapshot.to_dict(), position)
    if signal in {"PROBE_BUY", "ADD"}:
        ok, gate_reasons = multi_timeframe_gate({"weekly_patterns": weekly_patterns or [], "monthly_snapshot": monthly_snapshot or {}})
        if not ok: signal, reasons = "WATCH", [*reasons, *gate_reasons]
    reasons = [f"TREND_{snapshot.trend_state}", *reasons]
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "as_of_date": ordered[-1]["date"],
        "indicators": snapshot.to_dict(),
        "patterns": [item.to_dict() for item in patterns],
        "signal_preview": signal,
        "reasons": reasons,
    }


def resolve_signal(patterns: list[dict], snapshot: dict, position: dict | None = None) -> tuple[str, list[str]]:
    if position and snapshot.get("close", 0) < position["invalidation_price"]:
        return "EXIT", ["INVALIDATION_BROKEN"]
    bear = [p for p in patterns if p["direction"] == "BEARISH" and p["state"] == "CONFIRMED" and p["quality_score"] >= 60]
    if bear and position:
        return "REDUCE", [f"PATTERN_{p['pattern_type']}_CONFIRMED" for p in bear]
    bull = [p for p in patterns if p["direction"] == "BULLISH" and p["state"] == "CONFIRMED"]
    top = max(bull, key=lambda p: p["quality_score"], default=None)
    liquid = (snapshot.get("volume_avg20") or 0) * (snapshot.get("close") or 0) >= 300_000_000
    bonus = snapshot.get("ma_stack") or (snapshot.get("relative_strength_market") or 0) > 0
    threshold = 65 if bonus else 70
    if top and top["quality_score"] >= threshold and snapshot.get("trend_state") in ("UP", "SIDEWAYS") and (snapshot.get("volume_ratio20") or 0) >= 1.3 and (snapshot.get("rsi14") or 100) < 75 and liquid:
        reasons = [f"PATTERN_{top['pattern_type']}_CONFIRMED", "VOLUME_CONFIRMED", "LIQUIDITY_OK"]
        warning = invalidation_width_warning(snapshot.get("close", 0), top.get("invalidation_price") or 0, snapshot.get("atr14"))
        if warning: reasons.append(warning)
        if not position: return "PROBE_BUY", reasons
        return ("ADD", reasons) if str(top.get("start_index", "")) > str(position.get("entry_date", "")) else ("WATCH", reasons)
    ready = [p for p in patterns if p["state"] == "READY"]
    return "WATCH", [f"NEAR_TRIGGER_{p['pattern_type']}" for p in ready[:2]]
