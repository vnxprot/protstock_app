"""Free EOD price-volume flow proxy."""
from __future__ import annotations

from typing import Sequence


def _signed_money_volume(bar: dict) -> float:
    high, low, close = float(bar["high"]), float(bar["low"]), float(bar["close"])
    if high <= low:
        return 0.0
    multiplier = ((close - low) - (high - close)) / (high - low)
    return multiplier * float(bar.get("volume") or 0)


def calculate_flow(bars: Sequence[dict]) -> dict[str, float | str | None]:
    """Return a bounded, explainable EOD flow proxy from OHLCV only."""
    if len(bars) < 2:
        return {"flow_score": None, "flow_state": "UNKNOWN", "cmf20": None, "obv_slope20": None}
    window = list(bars[-20:])
    money_volume = [_signed_money_volume(bar) for bar in window]
    total_volume = sum(float(bar.get("volume") or 0) for bar in window)
    cmf20 = sum(money_volume) / total_volume if total_volume else 0.0
    obv = 0.0
    obv_series = []
    for previous, current in zip(bars[:-1], bars[1:]):
        volume = float(current.get("volume") or 0)
        obv += volume if float(current["close"]) > float(previous["close"]) else -volume if float(current["close"]) < float(previous["close"]) else 0.0
        obv_series.append(obv)
    span = min(20, len(obv_series))
    obv_slope = (obv_series[-1] - obv_series[-span]) / max(1.0, sum(float(bar.get("volume") or 0) for bar in bars[-span:])) if span > 1 else 0.0
    last, previous = bars[-1], bars[-2]
    price_change = (float(last["close"]) / float(previous["close"]) - 1) * 100 if float(previous["close"]) else 0.0
    volumes = [float(bar.get("volume") or 0) for bar in window[:-1]]
    average_volume = sum(volumes) / len(volumes) if volumes else 0.0
    volume_ratio = float(last.get("volume") or 0) / average_volume if average_volume else 1.0
    score = max(-100.0, min(100.0, cmf20 * 220 + obv_slope * 70 + (12 if price_change > 0 and volume_ratio >= 1.1 else -12 if price_change < 0 and volume_ratio >= 1.1 else 0)))
    state = "PURPLE" if score >= 45 else "GREEN" if score >= 12 else "BLUE" if score <= -45 else "RED" if score <= -12 else "NEUTRAL"
    return {"flow_score": round(score, 1), "flow_state": state, "cmf20": round(cmf20, 4), "obv_slope20": round(obv_slope, 4)}
