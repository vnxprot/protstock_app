from __future__ import annotations

from typing import Sequence

from .indicators import calculate_indicators
from .patterns import detect_patterns


ALGORITHM_VERSION = "core-rules-v1"


def analyze_bars(bars: Sequence[dict]) -> dict:
    if not bars:
        raise ValueError("bars cannot be empty")
    ordered = sorted(bars, key=lambda item: item["date"])
    snapshot = calculate_indicators(ordered)
    patterns = detect_patterns(ordered)
    signal, reasons = resolve_signal([item.to_dict() for item in patterns], snapshot.to_dict())
    reasons = [f"TREND_{snapshot.trend_state}", *reasons]
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "as_of_date": ordered[-1]["date"],
        "indicators": snapshot.to_dict(),
        "patterns": [item.to_dict() for item in patterns],
        "signal_preview": signal,
        "reasons": reasons,
    }


def resolve_signal(patterns: list[dict], snapshot: dict) -> tuple[str, list[str]]:
    bear = [p for p in patterns if p["direction"] == "BEARISH" and p["state"] == "CONFIRMED"]
    if bear:
        return "SELL", [f"PATTERN_{p['pattern_type']}_CONFIRMED" for p in bear]
    bull = [p for p in patterns if p["direction"] == "BULLISH" and p["state"] == "CONFIRMED"]
    top = max(bull, key=lambda p: p["quality_score"], default=None)
    liquid = (snapshot.get("volume_avg20") or 0) * (snapshot.get("close") or 0) >= 300_000_000
    if top and top["quality_score"] >= 70 and snapshot.get("trend_state") in ("UP", "SIDEWAYS") and (snapshot.get("volume_ratio20") or 0) >= 1.3 and (snapshot.get("rsi14") or 100) < 75 and liquid:
        return "BUY", [f"PATTERN_{top['pattern_type']}_CONFIRMED", "VOLUME_CONFIRMED", "LIQUIDITY_OK"]
    ready = [p for p in patterns if p["state"] == "READY"]
    return "WATCH", [f"NEAR_TRIGGER_{p['pattern_type']}" for p in ready[:2]]
