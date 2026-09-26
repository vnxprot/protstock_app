"""Shared, point-in-time flag and pennant geometry for Core and V0."""

from __future__ import annotations

from typing import Sequence


def _slope(values: list[float]) -> float:
    middle = (len(values) - 1) / 2
    denominator = sum((index - middle) ** 2 for index in range(len(values)))
    return sum((index - middle) * value for index, value in enumerate(values)) / denominator


def _volume_ratio(bars: Sequence[dict]) -> float:
    if len(bars) < 21:
        return 0.0
    average = sum(float(bar.get("volume") or 0) for bar in bars[-21:-1]) / 20
    return float(bars[-1].get("volume") or 0) / average if average > 0 else 0.0


def detect_flag_structure(bars: Sequence[dict], *, bullish: bool = True) -> dict | None:
    """Find a recent impulse followed by a contracting channel or pennant.

    The final closed bar is used only for breakout confirmation. All boundaries
    and volumes are measured on preceding bars, without a fixed pole/flag split.
    """
    if len(bars) < 21:
        return None
    volume_ratio = _volume_ratio(bars)
    candidates = []
    for flag_length in range(5, min(10, len(bars) - 5) + 1):
        flag = bars[-flag_length - 1:-1]
        highs = [float(bar["high"]) for bar in flag]
        lows = [float(bar["low"]) for bar in flag]
        width = max(highs) - min(lows)
        if width <= 0:
            continue
        half = flag_length // 2
        early_range = max(highs[:half]) - min(lows[:half])
        late_range = max(highs[-half:]) - min(lows[-half:])
        if early_range <= 0 or late_range > early_range * 1.05:
            continue
        high_slope, low_slope = _slope(highs), _slope(lows)
        converging = high_slope < -width * .015 and low_slope > width * .015 and late_range <= early_range * .8
        parallel = abs(high_slope - low_slope) <= width * .08
        channel = parallel and (
            high_slope <= width * .02 and low_slope <= width * .02 if bullish
            else high_slope >= -width * .02 and low_slope >= -width * .02
        )
        if not (converging or channel):
            continue
        flag_volume = sum(float(bar.get("volume") or 0) for bar in flag) / flag_length
        for pole_length in range(4, min(10, len(bars) - flag_length - 1) + 1):
            pole = bars[-flag_length - pole_length - 1:-flag_length - 1]
            start = float(pole[0]["open"])
            end = float(pole[-1]["close"])
            extreme = max(float(bar["high"]) for bar in pole) if bullish else min(float(bar["low"]) for bar in pole)
            move = extreme - start if bullish else start - extreme
            pole_return = (end / start - 1) * (1 if bullish else -1) if start > 0 else 0
            if pole_return < .12 or move <= 0:
                continue
            if bullish and end < extreme * .98 or not bullish and end > extreme * 1.02:
                continue
            retracement = (extreme - min(lows)) / move if bullish else (max(highs) - extreme) / move
            if not .05 <= retracement <= .5 or width > move * .65:
                continue
            pole_volume = sum(float(bar.get("volume") or 0) for bar in pole) / pole_length
            contraction = flag_volume / pole_volume if pole_volume > 0 else 1.0
            if contraction > .85:
                continue
            trigger = max(highs) if bullish else min(lows)
            invalidation = min(lows) if bullish else max(highs)
            close = float(bars[-1]["close"])
            price_break = close > trigger * 1.003 if bullish else close < trigger * .997
            confirmed = price_break and volume_ratio >= 1.3
            near = close >= trigger * .97 if bullish else close <= trigger * 1.03
            if not confirmed and not near:
                continue
            candidates.append({
                "pattern_type": "BULL_PENNANT" if bullish and converging else "BULL_FLAG" if bullish else "BEAR_FLAG",
                "state": "CONFIRMED" if confirmed else "READY",
                "start_index": len(bars) - flag_length - pole_length - 1,
                "pole_bars": pole_length,
                "flag_bars": flag_length,
                "trigger_price": trigger,
                "invalidation_price": invalidation,
                "pole_return_pct": round(pole_return * 100, 2),
                "retracement_pct": round(-retracement * 100 if bullish else retracement * 100, 2),
                "volume_contraction_ratio": round(contraction, 3),
                "volume_ratio20": round(volume_ratio, 3),
                "upper_slope": round(high_slope, 4),
                "lower_slope": round(low_slope, 4),
                "breakout_volume_ok": volume_ratio >= 1.3,
            })
    return max(candidates, key=lambda item: (item["flag_bars"], item["pole_return_pct"])) if candidates else None
