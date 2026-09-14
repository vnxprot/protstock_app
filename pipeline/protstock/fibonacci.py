from __future__ import annotations

from typing import Sequence

from .indicators import calculate_indicators
from .timeframes import aggregate_bars

FIB_RATIOS = (0.382, 0.5, 0.618)
FIB_BONUS_CAP = 4.0
FIB_MATCH_TOLERANCE = 0.015
SWING_MIN_ADVANCE = {"W": 0.12, "M": 0.20}
SWING_MIN_BARS = {"W": 4, "M": 3}


def fibonacci_levels(bars: Sequence[dict], timeframe: str) -> list[dict]:
    """Retracements of a clear, confirmed upswing; never use an open W/M candle."""
    if timeframe not in {"W", "M"}:
        return []
    complete = [bar for bar in bars if bar.get("is_complete") is True][-52:]
    if len(complete) < 12:
        return []
    lows, highs = [], []
    for i in range(2, len(complete) - 2):
        neighbors = [complete[j] for j in range(i - 2, i + 3) if j != i]
        if float(complete[i]["low"]) < min(float(bar["low"]) for bar in neighbors):
            lows.append(i)
        if float(complete[i]["high"]) > max(float(bar["high"]) for bar in neighbors):
            highs.append(i)
    for high_index in reversed(highs):
        for low_index in reversed(lows):
            if high_index - low_index < SWING_MIN_BARS[timeframe]:
                continue
            low, high = float(complete[low_index]["low"]), float(complete[high_index]["high"])
            if low <= 0 or (high - low) / low < SWING_MIN_ADVANCE[timeframe]:
                continue
            # Require a directional swing rather than two unrelated local extrema.
            leg = complete[low_index:high_index + 1]
            if low != min(float(bar["low"]) for bar in leg) or high != max(float(bar["high"]) for bar in leg):
                continue
            after = complete[high_index + 1:]
            if any(float(bar["low"]) < low or float(bar["high"]) > high * 1.03 for bar in after):
                continue
            typical_range = sum(float(bar["high"]) - float(bar["low"]) for bar in leg) / len(leg)
            if high - low < typical_range * 3:
                continue
            return [{"timeframe": timeframe, "ratio": ratio, "price": high - (high - low) * ratio,
                     "swing_low": low, "swing_high": high, "low_date": complete[low_index]["date"],
                     "high_date": complete[high_index]["date"]} for ratio in FIB_RATIOS]
    return []


def build_fibonacci_context(daily_bars: Sequence[dict]) -> dict:
    weekly = aggregate_bars(daily_bars, "W")
    monthly = aggregate_bars(daily_bars, "M")
    complete_weekly = [bar for bar in weekly if bar["is_complete"]]
    weekly_snapshot = calculate_indicators(complete_weekly).to_dict() if complete_weekly else {}
    return {"levels": fibonacci_levels(weekly, "W") + fibonacci_levels(monthly, "M"),
            "weekly_averages": {key: weekly_snapshot.get(key) for key in ("ema20", "sma50")}}


def near_price(a: float, b: float, tolerance: float = FIB_MATCH_TOLERANCE) -> bool:
    return b > 0 and abs(a / b - 1) <= tolerance


def matching_fibonacci(price: float, context: dict, zones: Sequence[dict] = (), *, pullback: bool = False) -> list[dict]:
    """A Fib level needs support/weekly-MA/pullback evidence, not a standalone vote."""
    matches = []
    for level in context.get("levels", []):
        if not near_price(price, float(level["price"])):
            continue
        sources = []
        if any(z.get("zone_type") == "SUPPORT" and float(z["lower_price"]) * (1 - FIB_MATCH_TOLERANCE) <= level["price"] <= float(z["upper_price"]) * (1 + FIB_MATCH_TOLERANCE) for z in zones):
            sources.append("SUPPORT")
        sources.extend(f"W_{key.upper()}" for key, value in context.get("weekly_averages", {}).items() if value and near_price(float(value), float(level["price"])))
        if pullback:
            sources.append("PULLBACK_SETUP")
        if sources:
            matches.append({**level, "sources": sources})
    return matches


def enrich_pattern_fibonacci(pattern: dict, context: dict, zones: Sequence[dict]) -> dict:
    if pattern.get("state") != "CONFIRMED" or pattern.get("direction") != "BULLISH":
        return pattern
    if "FIB_CONFLUENCE" in pattern.get("reasons", []):
        return pattern
    pullback = pattern.get("pattern_type") == "PULLBACK_CONTINUATION"
    price = float(pattern.get("invalidation_price") or 0)
    matches = matching_fibonacci(price, context, zones, pullback=pullback)
    if not matches:
        return pattern
    return {**pattern, "quality_score": min(100.0, float(pattern["quality_score"]) + FIB_BONUS_CAP),
            "reasons": [*pattern.get("reasons", []), "FIB_CONFLUENCE"],
            "evidence": {**(pattern.get("evidence") or {}), "fibonacci": matches, "fib_bonus": FIB_BONUS_CAP}}
