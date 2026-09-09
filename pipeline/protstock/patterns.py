from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Sequence


@dataclass(frozen=True)
class PatternCandidate:
    pattern_type: str
    state: str
    direction: str
    start_index: int
    end_index: int
    trigger_price: float | None
    invalidation_price: float | None
    quality_score: float
    reasons: tuple[str, ...]
    evidence: dict

    def to_dict(self) -> dict:
        value = asdict(self)
        value["reasons"] = list(self.reasons)
        return value


def _pivots(values: Sequence[float], radius: int, kind: str) -> list[int]:
    result: list[int] = []
    for i in range(radius, len(values) - radius):
        window = values[i - radius:i + radius + 1]
        if (kind == "low" and values[i] == min(window)) or (kind == "high" and values[i] == max(window)):
            result.append(i)
    return result


def detect_accumulation_base(bars: Sequence[dict]) -> PatternCandidate | None:
    if len(bars) < 20:
        return None
    window = bars[-60:]
    highs = [float(x["high"]) for x in window]
    lows = [float(x["low"]) for x in window]
    closes = [float(x["close"]) for x in window]
    volumes = [float(x.get("volume", 0)) for x in window]
    resistance, support = max(highs), min(lows)
    depth = (resistance - support) / resistance if resistance else 1
    recent_range = (max(highs[-10:]) - min(lows[-10:])) / closes[-1]
    prior_range = (max(highs[:10]) - min(lows[:10])) / closes[9]
    dry_up = sum(volumes[-10:]) / 10 < sum(volumes[-20:-10]) / 10 if len(window) >= 20 else False
    near_breakout = closes[-1] >= resistance * 0.97
    if depth > 0.35 or recent_range > prior_range * 1.15:
        return None
    score = min(100.0, 45 + (15 if dry_up else 0) + (20 if near_breakout else 0) + max(0, 20 - depth * 50))
    return PatternCandidate(
        "ACCUMULATION_BASE", "READY" if near_breakout else "FORMING", "BULLISH",
        len(bars) - len(window), len(bars) - 1, resistance, support, score,
        tuple(filter(None, ("RANGE_CONTRACTION", "VOLUME_DRY_UP" if dry_up else "", "NEAR_BREAKOUT" if near_breakout else ""))),
        {"depth_pct": round(depth * 100, 2), "recent_range_pct": round(recent_range * 100, 2)},
    )


def detect_double(bars: Sequence[dict], kind: str) -> PatternCandidate | None:
    if len(bars) < 25:
        return None
    values = [float(x["low"] if kind == "bottom" else x["high"]) for x in bars]
    points = _pivots(values, 3, "low" if kind == "bottom" else "high")
    if len(points) < 2:
        return None
    first, second = points[-2], points[-1]
    if not 5 <= second - first <= 60:
        return None
    tolerance = abs(values[first] - values[second]) / max(values[first], values[second])
    if tolerance > 0.05:
        return None
    middle_slice = bars[first:second + 1]
    neckline = max(float(x["high"]) for x in middle_slice) if kind == "bottom" else min(float(x["low"]) for x in middle_slice)
    close = float(bars[-1]["close"])
    confirmed = close > neckline if kind == "bottom" else close < neckline
    pattern_type = "DOUBLE_BOTTOM" if kind == "bottom" else "DOUBLE_TOP"
    direction = "BULLISH" if kind == "bottom" else "BEARISH"
    invalidation = min(values[first], values[second]) if kind == "bottom" else max(values[first], values[second])
    return PatternCandidate(
        pattern_type, "CONFIRMED" if confirmed else "READY", direction, first, len(bars) - 1,
        neckline, invalidation, max(45.0, 82 - tolerance * 500),
        ("TWO_CONFIRMED_PIVOTS", "NECKLINE_BREAK" if confirmed else "NEAR_NECKLINE"),
        {"first_pivot": first, "second_pivot": second, "similarity_pct": round((1 - tolerance) * 100, 2)},
    )


def detect_triangle(bars: Sequence[dict]) -> PatternCandidate | None:
    if len(bars) < 20:
        return None
    window = bars[-40:]
    highs = [float(x["high"]) for x in window]
    lows = [float(x["low"]) for x in window]
    half = len(window) // 2
    high_slope = (sum(highs[half:]) / len(highs[half:])) - (sum(highs[:half]) / half)
    low_slope = (sum(lows[half:]) / len(lows[half:])) - (sum(lows[:half]) / half)
    scale = float(window[-1]["close"])
    flat = scale * 0.015
    if abs(high_slope) <= flat and low_slope > flat:
        ptype, direction = "ASCENDING_TRIANGLE", "BULLISH"
    elif high_slope < -flat and abs(low_slope) <= flat:
        ptype, direction = "DESCENDING_TRIANGLE", "BEARISH"
    elif high_slope < -flat and low_slope > flat:
        ptype, direction = "SYMMETRICAL_TRIANGLE", "NEUTRAL"
    else:
        return None
    upper, lower = max(highs[-10:]), min(lows[-10:])
    close = float(window[-1]["close"])
    state = "READY" if min(abs(upper - close), abs(close - lower)) / close < 0.03 else "FORMING"
    return PatternCandidate(ptype, state, direction, len(bars) - len(window), len(bars) - 1, upper, lower, 62.0,
                            ("CONVERGING_BOUNDARIES", "RANGE_CONTRACTION"),
                            {"upper_slope": high_slope, "lower_slope": low_slope})


def detect_flag(bars: Sequence[dict]) -> PatternCandidate | None:
    if len(bars) < 18:
        return None
    pole = bars[-18:-8]
    flag = bars[-8:]
    pole_return = float(pole[-1]["close"]) / float(pole[0]["open"]) - 1
    flag_return = float(flag[-1]["close"]) / float(flag[0]["open"]) - 1
    if abs(pole_return) < 0.12 or pole_return * flag_return > 0 or abs(flag_return) > abs(pole_return) * 0.5:
        return None
    bullish = pole_return > 0
    trigger = max(float(x["high"]) for x in flag) if bullish else min(float(x["low"]) for x in flag)
    invalidation = min(float(x["low"]) for x in flag) if bullish else max(float(x["high"]) for x in flag)
    close = float(flag[-1]["close"])
    confirmed = close > trigger if bullish else close < trigger
    return PatternCandidate("BULL_FLAG" if bullish else "BEAR_FLAG", "CONFIRMED" if confirmed else "READY",
                            "BULLISH" if bullish else "BEARISH", len(bars) - 18, len(bars) - 1,
                            trigger, invalidation, 68.0, ("IMPULSE_POLE", "CONTROLLED_RETRACEMENT"),
                            {"pole_return_pct": round(pole_return * 100, 2), "retracement_pct": round(flag_return * 100, 2)})


def detect_patterns(bars: Sequence[dict]) -> list[PatternCandidate]:
    candidates = [detect_accumulation_base(bars), detect_double(bars, "bottom"), detect_double(bars, "top"), detect_triangle(bars), detect_flag(bars)]
    return sorted((candidate for candidate in candidates if candidate is not None), key=lambda item: item.quality_score, reverse=True)
