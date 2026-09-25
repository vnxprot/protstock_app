"""Free EOD price-volume flow proxy."""
from __future__ import annotations

from typing import Sequence


def _signed_money_volume(bar: dict) -> float:
    high, low, close = float(bar["high"]), float(bar["low"]), float(bar["close"])
    if high <= low:
        return 0.0
    return (((close - low) - (high - close)) / (high - low)) * float(bar.get("volume") or 0)


def calculate_flow(bars: Sequence[dict]) -> dict[str, float | str | None]:
    """Return a 20-session flow score and an explainable current-session colour bar."""
    if len(bars) < 2:
        return {"flow_score": None, "flow_state": "UNKNOWN", "cmf20": None, "obv_slope20": None, "flow_volume_ratio20": None, "flow_clv": None}
    window = list(bars[-20:])
    total_volume = sum(float(bar.get("volume") or 0) for bar in window)
    cmf20 = sum(_signed_money_volume(bar) for bar in window) / total_volume if total_volume else 0.0
    obv, obv_series = 0.0, []
    for previous, current in zip(bars[:-1], bars[1:]):
        volume = float(current.get("volume") or 0)
        obv += volume if float(current["close"]) > float(previous["close"]) else -volume if float(current["close"]) < float(previous["close"]) else 0.0
        obv_series.append(obv)
    span = min(20, len(obv_series))
    obv_slope = (obv_series[-1] - obv_series[-span]) / max(1.0, sum(float(bar.get("volume") or 0) for bar in bars[-span:])) if span > 1 else 0.0
    last, previous = bars[-1], bars[-2]
    average_volume = sum(float(bar.get("volume") or 0) for bar in bars[-21:-1]) / min(20, len(bars) - 1)
    volume_ratio = float(last.get("volume") or 0) / average_volume if average_volume else None
    high, low, close = float(last["high"]), float(last["low"]), float(last["close"])
    clv = (close - low) / (high - low) if high > low else 0.5
    rising, falling = close > float(previous["close"]), close < float(previous["close"])
    # The colour is today's bar; score stays a separate 20-session context.
    if rising and volume_ratio is not None and volume_ratio >= 1.5 and clv >= 0.7:
        state = "PURPLE"
    elif rising and volume_ratio is not None and volume_ratio >= 1.0:
        state = "GREEN"
    elif falling and volume_ratio is not None and volume_ratio >= 1.5 and clv <= 0.3:
        state = "BLUE"
    elif falling and volume_ratio is not None and volume_ratio >= 1.0:
        state = "RED"
    else:
        state = "NEUTRAL"
    score = max(-100.0, min(100.0, cmf20 * 220 + obv_slope * 70))
    return {"flow_score": round(score, 1), "flow_state": state, "cmf20": round(cmf20, 4), "obv_slope20": round(obv_slope, 4), "flow_volume_ratio20": round(volume_ratio, 3) if volume_ratio is not None else None, "flow_clv": round(clv, 4)}
