from __future__ import annotations

from typing import Sequence

from .indicators import calculate_indicators
from .patterns import detect_patterns


ALGORITHM_VERSION = "phase2.1"


def analyze_bars(bars: Sequence[dict]) -> dict:
    if not bars:
        raise ValueError("bars cannot be empty")
    ordered = sorted(bars, key=lambda item: item["date"])
    snapshot = calculate_indicators(ordered)
    patterns = detect_patterns(ordered)
    bullish = sum(item.quality_score for item in patterns if item.direction == "BULLISH")
    bearish = sum(item.quality_score for item in patterns if item.direction == "BEARISH")
    signal = "WATCH"
    if bullish >= 65 and snapshot.trend_state == "UP":
        signal = "PROBE_BUY"
    elif bearish >= 65 or snapshot.trend_state == "DOWN":
        signal = "REDUCE"
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "as_of_date": ordered[-1]["date"],
        "indicators": snapshot.to_dict(),
        "patterns": [item.to_dict() for item in patterns],
        "signal_preview": signal,
        "reasons": [
            f"TREND_{snapshot.trend_state}",
            *[f"PATTERN_{item.pattern_type}_{item.state}" for item in patterns[:3]],
        ],
    }

