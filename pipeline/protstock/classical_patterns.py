from __future__ import annotations

from typing import Any, Sequence


MODEL_LABELS = {
    "flat_base": "Breakout nền phẳng",
    "flag_pennant": "Cờ tăng và Pennant",
    "double_bottom": "Hai đáy",
    "double_top": "Hai đỉnh",
    "head_shoulders": "Vai đầu vai và Vai đầu vai ngược",
}


def detect_classical_patterns(bars: Sequence[dict], snapshot: dict | None = None) -> list[dict[str, Any]]:
    """Detect the five deliberately strict v0.0 classical-chart families.

    The function is pure and returns evidence-rich candidates.  It does not make
    a trading decision; the Core Engine supplies market, multi-timeframe and
    portfolio gates afterwards.
    """
    ordered = sorted(bars, key=lambda item: item["date"])
    snapshot = snapshot or {}
    candidates = [
        _flat_base(ordered, snapshot),
        _flag_or_pennant(ordered, snapshot),
        _double(ordered, snapshot, "bottom"),
        _double(ordered, snapshot, "top"),
        _head_shoulders(ordered, snapshot, "inverse"),
        _head_shoulders(ordered, snapshot, "top"),
    ]
    return [candidate for candidate in candidates if candidate is not None]


def _volume_ratio(bars: Sequence[dict], lookback: int = 20) -> float:
    if len(bars) <= lookback:
        return 0.0
    average = sum(float(item.get("volume") or 0) for item in bars[-lookback - 1:-1]) / lookback
    return float(bars[-1].get("volume") or 0) / average if average else 0.0


def _candidate(*, model: str, pattern_type: str, direction: str, state: str, quality: float, trigger: float, invalidation: float, reasons: list[str], evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": model,
        "pattern_type": pattern_type,
        "direction": direction,
        "state": state,
        "quality_score": round(min(100.0, quality), 1),
        "trigger_price": round(trigger, 4),
        "invalidation_price": round(invalidation, 4),
        "reasons": reasons,
        "evidence": evidence,
    }


def _flat_base(bars: Sequence[dict], snapshot: dict) -> dict[str, Any] | None:
    if len(bars) < 41:
        return None
    base = bars[-21:-1]
    prior = bars[-41:-21]
    resistance = max(float(item["high"]) for item in base)
    support = min(float(item["low"]) for item in base)
    depth = (resistance - support) / resistance if resistance else 1.0
    prior_return = float(prior[-1]["close"]) / float(prior[0]["close"]) - 1
    close = float(bars[-1]["close"])
    volume_ratio = _volume_ratio(bars)
    resistance_tests = sum(float(item["high"]) >= resistance * 0.985 for item in base)
    support_tests = sum(float(item["low"]) <= support * 1.015 for item in base)
    base_volume = sum(float(item.get("volume") or 0) for item in base) / len(base)
    prior_volume = sum(float(item.get("volume") or 0) for item in prior) / len(prior)
    contraction = base_volume / prior_volume if prior_volume else 1.0
    prior_up = prior_return >= 0.08 or snapshot.get("trend_state") == "UP"
    if not prior_up or depth > 0.15 or resistance_tests < 2 or support_tests < 2:
        return None
    confirmed = close > resistance and volume_ratio >= 1.3
    ready = close >= resistance * 0.97
    state = "CONFIRMED" if confirmed else "READY" if ready else "FORMING"
    quality = 35 + min(15, resistance_tests + support_tests) + (10 if contraction <= 0.9 else 0) + (20 if confirmed else 10 if ready else 0)
    return _candidate(
        model="flat_base", pattern_type="FLAT_BASE_BREAKOUT", direction="BULLISH", state=state,
        quality=quality, trigger=resistance, invalidation=support,
        reasons=["PRIOR_UPTREND", "TIGHT_FLAT_BASE", "VOLUME_CONTRACTION" if contraction <= 0.9 else "BASE_VOLUME_MIXED", "BREAKOUT_VOLUME" if confirmed else "NEAR_BASE_BREAKOUT" if ready else "BASE_FORMING"],
        evidence={"base_bars": len(base), "depth_pct": round(depth * 100, 2), "prior_return_pct": round(prior_return * 100, 2), "resistance_tests": resistance_tests, "support_tests": support_tests, "volume_contraction_ratio": round(contraction, 3), "volume_ratio20": round(volume_ratio, 3)},
    )


def _flag_or_pennant(bars: Sequence[dict], snapshot: dict) -> dict[str, Any] | None:
    if len(bars) < 22:
        return None
    pole, consolidation = bars[-22:-12], bars[-12:-1]
    pole_return = float(pole[-1]["close"]) / float(pole[0]["open"]) - 1
    retracement = float(consolidation[-1]["close"]) / float(pole[-1]["close"]) - 1
    if pole_return < 0.12 or retracement > 0 or abs(retracement) > pole_return * 0.5:
        return None
    highs = [float(item["high"]) for item in consolidation]
    lows = [float(item["low"]) for item in consolidation]
    upper_slope = highs[-1] - highs[0]
    lower_slope = lows[-1] - lows[0]
    converging = (max(highs[:5]) - min(lows[:5])) > (max(highs[-5:]) - min(lows[-5:]))
    pattern_type = "BULL_PENNANT" if converging else "BULL_FLAG"
    trigger = max(highs)
    invalidation = min(lows)
    close = float(bars[-1]["close"])
    volume_ratio = _volume_ratio(bars)
    consolidation_volume = sum(float(item.get("volume") or 0) for item in consolidation) / len(consolidation)
    pole_volume = sum(float(item.get("volume") or 0) for item in pole) / len(pole)
    contraction = consolidation_volume / pole_volume if pole_volume else 1.0
    confirmed = close > trigger and volume_ratio >= 1.3
    ready = close >= trigger * 0.97
    state = "CONFIRMED" if confirmed else "READY" if ready else "FORMING"
    quality = 35 + min(20, pole_return * 100) + (10 if contraction <= 0.85 else 0) + (20 if confirmed else 10 if ready else 0)
    return _candidate(
        model="flag_pennant", pattern_type=pattern_type, direction="BULLISH", state=state,
        quality=quality, trigger=trigger, invalidation=invalidation,
        reasons=["IMPULSE_POLE", "PENNANT_CONVERGENCE" if converging else "FLAG_CONTROLLED_RETRACE", "VOLUME_CONTRACTION" if contraction <= 0.85 else "FLAG_VOLUME_MIXED", "BREAKOUT_VOLUME" if confirmed else "NEAR_FLAG_BREAKOUT" if ready else "FLAG_FORMING"],
        evidence={"pole_return_pct": round(pole_return * 100, 2), "retracement_pct": round(retracement * 100, 2), "volume_contraction_ratio": round(contraction, 3), "volume_ratio20": round(volume_ratio, 3), "upper_slope": round(upper_slope, 4), "lower_slope": round(lower_slope, 4)},
    )


def _pivots(values: Sequence[float], kind: str, radius: int = 3) -> list[int]:
    return [index for index in range(radius, len(values) - radius) if values[index] == (min(values[index - radius:index + radius + 1]) if kind == "low" else max(values[index - radius:index + radius + 1]))]


def _double(bars: Sequence[dict], snapshot: dict, kind: str) -> dict[str, Any] | None:
    if len(bars) < 45:
        return None
    values = [float(item["low"] if kind == "bottom" else item["high"]) for item in bars]
    points = _pivots(values, "low" if kind == "bottom" else "high")
    if len(points) < 2:
        return None
    first, second = points[-2:]
    gap = second - first
    if not 15 <= gap <= 65:
        return None
    tolerance = abs(values[first] - values[second]) / max(values[first], values[second])
    if tolerance > 0.05:
        return None
    between = bars[first:second + 1]
    neckline = max(float(item["high"]) for item in between) if kind == "bottom" else min(float(item["low"]) for item in between)
    amplitude = (neckline - min(values[first], values[second])) / neckline if kind == "bottom" else (max(values[first], values[second]) - neckline) / max(values[first], values[second])
    if amplitude < 0.08:
        return None
    prior = bars[max(0, first - 20):first]
    prior_return = (float(prior[-1]["close"]) / float(prior[0]["close"]) - 1) if len(prior) > 1 else 0
    trend_ok = prior_return <= -0.08 if kind == "bottom" else prior_return >= 0.08
    if not trend_ok:
        return None
    close, volume_ratio = float(bars[-1]["close"]), _volume_ratio(bars)
    confirmed = (close > neckline if kind == "bottom" else close < neckline) and volume_ratio >= 1.3
    ready = close >= neckline * 0.97 if kind == "bottom" else close <= neckline * 1.03
    state = "CONFIRMED" if confirmed else "READY" if ready else "FORMING"
    direction = "BULLISH" if kind == "bottom" else "BEARISH"
    pattern_type = "DOUBLE_BOTTOM" if kind == "bottom" else "DOUBLE_TOP"
    invalidation = min(values[first], values[second]) if kind == "bottom" else max(values[first], values[second])
    quality = 35 + min(20, gap / 3) + max(0, 15 - tolerance * 200) + (20 if confirmed else 10 if ready else 0)
    return _candidate(
        model=f"double_{kind}", pattern_type=pattern_type, direction=direction, state=state, quality=quality,
        trigger=neckline, invalidation=invalidation,
        reasons=["PRIOR_TREND", "TWO_SIMILAR_PIVOTS", "MEANINGFUL_NECKLINE", "BREAKOUT_VOLUME" if confirmed else "NEAR_NECKLINE" if ready else "DOUBLE_FORMING"],
        evidence={"first_pivot": first, "second_pivot": second, "pivot_gap_bars": gap, "similarity_pct": round((1 - tolerance) * 100, 2), "amplitude_pct": round(amplitude * 100, 2), "prior_return_pct": round(prior_return * 100, 2), "volume_ratio20": round(volume_ratio, 3)},
    )


def _head_shoulders(bars: Sequence[dict], snapshot: dict, kind: str) -> dict[str, Any] | None:
    if len(bars) < 55:
        return None
    inverse = kind == "inverse"
    values = [float(item["low"] if inverse else item["high"]) for item in bars]
    points = _pivots(values, "low" if inverse else "high")
    if len(points) < 3:
        return None
    left, head, right = points[-3:]
    if not (10 <= head - left <= 45 and 10 <= right - head <= 45):
        return None
    shoulder_tolerance = abs(values[left] - values[right]) / max(values[left], values[right])
    head_clearance = (min(values[left], values[right]) - values[head]) / min(values[left], values[right]) if inverse else (values[head] - max(values[left], values[right])) / values[head]
    if shoulder_tolerance > 0.08 or head_clearance < 0.03:
        return None
    first_neck = max(float(item["high"]) for item in bars[left:head + 1]) if inverse else min(float(item["low"]) for item in bars[left:head + 1])
    second_neck = max(float(item["high"]) for item in bars[head:right + 1]) if inverse else min(float(item["low"]) for item in bars[head:right + 1])
    neckline = (first_neck + second_neck) / 2
    prior = bars[max(0, left - 20):left]
    prior_return = (float(prior[-1]["close"]) / float(prior[0]["close"]) - 1) if len(prior) > 1 else 0
    if (inverse and prior_return > -0.08) or (not inverse and prior_return < 0.08):
        return None
    close, volume_ratio = float(bars[-1]["close"]), _volume_ratio(bars)
    confirmed = (close > neckline if inverse else close < neckline) and volume_ratio >= 1.3
    ready = close >= neckline * 0.97 if inverse else close <= neckline * 1.03
    state = "CONFIRMED" if confirmed else "READY" if ready else "FORMING"
    direction = "BULLISH" if inverse else "BEARISH"
    pattern_type = "INVERSE_HEAD_SHOULDERS" if inverse else "HEAD_SHOULDERS_TOP"
    invalidation = values[right]
    quality = 40 + min(20, (right - left) / 3) + max(0, 15 - shoulder_tolerance * 150) + (20 if confirmed else 10 if ready else 0)
    return _candidate(
        model="head_shoulders", pattern_type=pattern_type, direction=direction, state=state, quality=quality,
        trigger=neckline, invalidation=invalidation,
        reasons=["PRIOR_TREND", "THREE_PIVOT_STRUCTURE", "HEAD_CLEARANCE", "SLOPING_NECKLINE", "BREAKOUT_VOLUME" if confirmed else "NEAR_NECKLINE" if ready else "HEAD_SHOULDERS_FORMING"],
        evidence={"left_shoulder": left, "head": head, "right_shoulder": right, "shoulder_similarity_pct": round((1 - shoulder_tolerance) * 100, 2), "head_clearance_pct": round(head_clearance * 100, 2), "neckline_left": round(first_neck, 4), "neckline_right": round(second_neck, 4), "prior_return_pct": round(prior_return * 100, 2), "volume_ratio20": round(volume_ratio, 3)},
    )
