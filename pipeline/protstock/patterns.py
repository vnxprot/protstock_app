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


def _breakout_volume_ok(bars: Sequence[dict], multiplier: float, lookback: int = 20) -> bool:
    if len(bars) < lookback + 1:
        return False
    avg = sum(float(x.get("volume", 0)) for x in bars[-lookback - 1:-1]) / lookback
    return avg > 0 and float(bars[-1].get("volume", 0)) > avg * multiplier


def _quality(bars: Sequence[dict], start: int, support: float, resistance: float, confirmed: bool, near_breakout: bool) -> tuple[float, dict]:
    """Score structure, not just proximity to a breakout.

    Every component is persisted so rules and the UI can explain the score.
    """
    sample = bars[start:]
    length = len(sample)
    third = max(3, length // 3)
    ranges = [(float(bar["high"]) - float(bar["low"])) / max(float(bar["close"]), 0.0001) for bar in sample]
    volumes = [float(bar.get("volume", 0)) for bar in sample]
    early_range = sum(ranges[:third]) / third
    late_range = sum(ranges[-third:]) / third
    early_volume = sum(volumes[:third]) / third
    late_volume = sum(volumes[-third:]) / third
    support_tests = sum(float(bar["low"]) <= support * 1.015 for bar in sample)
    resistance_tests = sum(float(bar["high"]) >= resistance * 0.985 for bar in sample)
    tightness_ratio = late_range / early_range if early_range else 1.0
    contraction_ratio = late_volume / early_volume if early_volume else 1.0
    components = {
        "base_length_score": round(min(15.0, max(0.0, (length - 10) * 0.5)), 1),
        "volatility_tightness_score": round(min(20.0, max(0.0, (1 - tightness_ratio) * 40)), 1),
        "boundary_tests_score": round(min(20.0, (support_tests + resistance_tests) * 2.5), 1),
        "volume_contraction_score": round(min(20.0, max(0.0, (1 - contraction_ratio) * 35)), 1),
        "breakout_confirmation_score": 25.0 if confirmed else 12.0 if near_breakout else 0.0,
    }
    evidence = {
        **components, "base_length_bars": length, "volatility_ratio": round(tightness_ratio, 3),
        "support_tests": support_tests, "resistance_tests": resistance_tests,
        "volume_contraction_ratio": round(contraction_ratio, 3),
    }
    return round(sum(components.values()), 1), evidence


def detect_accumulation_base(bars: Sequence[dict]) -> PatternCandidate | None:
    if len(bars) < 20:
        return None
    window = bars[-60:]
    highs = [float(x["high"]) for x in window]
    lows = [float(x["low"]) for x in window]
    closes = [float(x["close"]) for x in window]
    volumes = [float(x.get("volume", 0)) for x in window]
    resistance, support = max(highs[:-1]), min(lows)
    depth = (resistance - support) / resistance if resistance else 1
    recent_range = (max(highs[-10:]) - min(lows[-10:])) / closes[-1]
    prior_range = (max(highs[:10]) - min(lows[:10])) / closes[9]
    dry_up = sum(volumes[-10:]) / 10 < sum(volumes[-20:-10]) / 10 if len(window) >= 20 else False
    breakout_volume_ok = _breakout_volume_ok(window, 1.5)
    confirmed = closes[-1] > resistance and breakout_volume_ok
    near_breakout = closes[-1] >= resistance * 0.97
    if depth > 0.35 or recent_range > prior_range * 1.15:
        return None
    score, quality = _quality(window, 0, support, resistance, confirmed, near_breakout)
    return PatternCandidate(
        "ACCUMULATION_BASE", "CONFIRMED" if confirmed else "READY" if near_breakout else "FORMING", "BULLISH",
        len(bars) - len(window), len(bars) - 1, resistance, support, score,
        tuple(filter(None, ("RANGE_CONTRACTION", "VOLUME_DRY_UP" if dry_up else "", "BREAKOUT_VOLUME" if breakout_volume_ok else "", "NEEDS_VOLUME_CONFIRMATION" if closes[-1] > resistance and not breakout_volume_ok else "", "NEAR_BREAKOUT" if near_breakout else ""))),
        {"depth_pct": round(depth * 100, 2), "recent_range_pct": round(recent_range * 100, 2), "breakout_volume_ok": breakout_volume_ok, **quality},
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
    volume_ok = _breakout_volume_ok(bars, 1.3)
    confirmed = (close > neckline if kind == "bottom" else close < neckline) and volume_ok
    pattern_type = "DOUBLE_BOTTOM" if kind == "bottom" else "DOUBLE_TOP"
    direction = "BULLISH" if kind == "bottom" else "BEARISH"
    invalidation = min(values[first], values[second]) if kind == "bottom" else max(values[first], values[second])
    score, quality = _quality(bars, first, invalidation if kind == "bottom" else neckline, neckline if kind == "bottom" else invalidation, confirmed, not confirmed)
    return PatternCandidate(
        pattern_type, "CONFIRMED" if confirmed else "READY", direction, first, len(bars) - 1,
        neckline, invalidation, score,
        tuple(filter(None, ("TWO_CONFIRMED_PIVOTS", "NECKLINE_BREAK" if confirmed else "NEAR_NECKLINE", "BREAKOUT_VOLUME" if volume_ok else "", "NEEDS_VOLUME_CONFIRMATION" if ((close > neckline) if kind == "bottom" else (close < neckline)) and not volume_ok else ""))),
        {"first_pivot": first, "second_pivot": second, "similarity_pct": round((1 - tolerance) * 100, 2), "breakout_volume_ok": volume_ok, **quality},
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
    price_break = close > upper if direction == "BULLISH" else close < lower if direction == "BEARISH" else False
    volume_ok = _breakout_volume_ok(window, 1.4)
    confirmed = price_break and volume_ok
    score, quality = _quality(window, 0, lower, upper, confirmed, state == "READY")
    return PatternCandidate(ptype, "CONFIRMED" if confirmed else state, direction, len(bars) - len(window), len(bars) - 1, upper, lower, score,
                            tuple(filter(None, ("CONVERGING_BOUNDARIES", "RANGE_CONTRACTION", "BREAKOUT_VOLUME" if volume_ok else "", "NEEDS_VOLUME_CONFIRMATION" if price_break and not volume_ok else ""))),
                            {"upper_slope": high_slope, "lower_slope": low_slope, "breakout_volume_ok": volume_ok, **quality})


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
    price_break = close > trigger if bullish else close < trigger
    volume_ok = _breakout_volume_ok(bars, 1.1)
    confirmed = price_break and volume_ok
    score, quality = _quality(bars, len(bars) - 18, invalidation, trigger, confirmed, not confirmed)
    return PatternCandidate("BULL_FLAG" if bullish else "BEAR_FLAG", "CONFIRMED" if confirmed else "READY",
                            "BULLISH" if bullish else "BEARISH", len(bars) - 18, len(bars) - 1,
                            trigger, invalidation, score, tuple(filter(None, ("IMPULSE_POLE", "CONTROLLED_RETRACEMENT", "BREAKOUT_VOLUME" if volume_ok else "", "NEEDS_VOLUME_CONFIRMATION" if price_break and not volume_ok else ""))),
                            {"pole_return_pct": round(pole_return * 100, 2), "retracement_pct": round(flag_return * 100, 2), "breakout_volume_ok": volume_ok, **quality})


def detect_patterns(bars: Sequence[dict]) -> list[PatternCandidate]:
    candidates = [detect_accumulation_base(bars), detect_double(bars, "bottom"), detect_double(bars, "top"), detect_triangle(bars), detect_flag(bars)]
    return sorted((candidate for candidate in candidates if candidate is not None), key=lambda item: item.quality_score, reverse=True)
