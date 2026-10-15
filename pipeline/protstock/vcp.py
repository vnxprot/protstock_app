"""Shared daily VCP structure for Champion and Challenger.

Vendor OHLCV is consumed as reported. No corporate-action inference is made.
"""
from __future__ import annotations

from statistics import mean
from typing import Sequence

from .indicators import calculate_indicators


def _date(bar: dict) -> str:
    return str(bar.get("date") or bar.get("trading_date") or "")


def _pivot_events(bars: Sequence[dict]) -> list[tuple[str, int, float]]:
    """Two closed candles on either side confirm each local turning point."""
    events: list[tuple[str, int, float]] = []
    for i in range(2, len(bars) - 2):
        high, low = float(bars[i]["high"]), float(bars[i]["low"])
        if high > max(float(bars[j]["high"]) for j in (i - 2, i - 1)) and high >= max(float(bars[j]["high"]) for j in (i + 1, i + 2)):
            events.append(("H", i, high))
        if low < min(float(bars[j]["low"]) for j in (i - 2, i - 1)) and low <= min(float(bars[j]["low"]) for j in (i + 1, i + 2)):
            events.append(("L", i, low))
    events.sort(key=lambda item: (item[1], item[0]))
    alternating: list[tuple[str, int, float]] = []
    for event in events:
        if alternating and event[0] == alternating[-1][0]:
            if (event[0] == "H" and event[2] > alternating[-1][2]) or (event[0] == "L" and event[2] < alternating[-1][2]):
                alternating[-1] = event
        elif not alternating or event[1] != alternating[-1][1]:
            alternating.append(event)
    return alternating


def _stage_two(bars: Sequence[dict]) -> bool:
    # A 20-session slope of SMA200 requires 220 completed daily bars.
    if len(bars) < 220:
        return False
    closes = [float(bar["close"]) for bar in bars]
    close = closes[-1]
    ma50, ma150, ma200 = (mean(closes[-n:]) for n in (50, 150, 200))
    prior200 = mean(closes[-220:-20])
    high52 = max(float(bar["high"]) for bar in bars[-252:])
    return close > ma50 > ma150 and close > ma200 > prior200 and close >= .75 * high52


def detect_vcp(bars: Sequence[dict], *, turnover_floor_vnd: float = 3_000_000_000) -> dict | None:
    """Return READY, CONFIRMED, or EXPIRED evidence for the latest closed day."""
    if len(bars) < 220 or not _stage_two(bars):
        return None
    today = bars[-1]
    history = bars[:-1]
    current_index = len(bars) - 1
    events = _pivot_events(history[-102:])
    offset = len(history) - len(history[-102:])
    events = [(kind, index + offset, value) for kind, index, value in events]
    pairs: list[tuple[tuple[str, int, float], tuple[str, int, float]]] = []
    for first, second in zip(events, events[1:]):
        if first[0] == "H" and second[0] == "L" and first[2] > second[2] and (first[2] - second[2]) / first[2] >= .02:
            pairs.append((first, second))
    candidate = None
    for count in (4, 3, 2):
        if len(pairs) < count:
            continue
        selected = pairs[-count:]
        if any(selected[i][0][1] <= selected[i - 1][1][1] for i in range(1, count)):
            continue
        first_index = selected[0][0][1]
        last_low_index = selected[-1][1][1]
        age = current_index - last_low_index
        if not (25 <= current_index - first_index <= 100 and 3 <= age <= 13):
            continue
        depths = [(high[2] - low[2]) / high[2] for high, low in selected]
        if not (.07 <= depths[0] <= .30 and .02 <= depths[-1] <= .10
                and all(depths[i] <= .8 * depths[i - 1] for i in range(1, count))):
            continue
        pivot = selected[-1][0][2]
        base_high = max(float(bar["high"]) for bar in bars[first_index:current_index])
        if pivot < .95 * base_high:
            continue
        candidate = (selected, depths, pivot, first_index, last_low_index)
        break
    if candidate is None:
        return None
    selected, depths, pivot, first_index, low_index = candidate
    close = float(today["close"])
    prior_close = float(history[-1]["close"])
    last_low = selected[-1][1][2]
    atr = calculate_indicators(bars).atr14
    if atr is None:
        return None
    stop = last_low - .5 * atr
    risk = (close - stop) / close if close > 0 else 1
    near = .97 * pivot <= close <= 1.04 * pivot
    crossed = prior_close <= pivot < close
    prior_crosses = [i for i in range(low_index + 1, current_index)
                     if float(bars[i - 1]["close"]) <= pivot < float(bars[i]["close"])]
    recent_cross = prior_crosses[-1] if prior_crosses else None
    expired = (age > 12 or close > 1.04 * pivot or close < last_low
               or recent_cross is not None and current_index - recent_cross >= 3)
    state = ("CONFIRMED" if crossed and not expired else "EXPIRED" if expired
             else "READY" if near and recent_cross is None else None)
    if state is None:
        return None
    coil = history[-5:] if state == "CONFIRMED" else bars[-5:]
    before_coil = bars[-25:-5]
    if len(before_coil) < 20 or (state != "EXPIRED" and any(float(bar.get("volume") or 0) <= 0 for bar in coil)):
        return None
    avg_before = mean(float(bar["volume"]) for bar in before_coil)
    dry = avg_before > 0 and mean(float(bar["volume"]) for bar in coil) <= .75 * avg_before
    dry_count = 0
    for bar in coil:
        index = next(i for i in range(len(bars) - 25, len(bars)) if bars[i] is bar)
        avg20 = mean(float(item.get("volume") or 0) for item in bars[index - 20:index])
        dry_count += avg20 > 0 and float(bar["volume"]) <= .6 * avg20
    tightness = (max(float(bar["high"]) for bar in coil) - min(float(bar["low"]) for bar in coil)) / pivot
    avg_volume20 = mean(float(bar.get("volume") or 0) for bar in history[-20:])
    turnover = mean(float(bar["close"]) * float(bar.get("volume") or 0) * 1000 for bar in history[-20:])
    if state != "EXPIRED" and not (dry and dry_count >= 2 and tightness <= .08 and turnover >= turnover_floor_vnd):
        return None
    spread = float(today["high"]) - float(today["low"])
    quality = spread > 0 and close >= float(today["low"]) + .5 * spread and close >= float(today["open"])
    volume_ratio = float(today.get("volume") or 0) / avg_volume20 if avg_volume20 > 0 else 0
    if state == "CONFIRMED" and not (quality and volume_ratio >= 1.4 and close <= pivot * 1.04 and .03 <= risk <= .10):
        state = "EXPIRED" if close > pivot * 1.04 else "READY"
    setup_id = f"{_date(bars[first_index])}:{_date(bars[selected[-1][0][1]])}:{pivot:.4f}"
    return {"state": state, "setup_id": setup_id, "base_start": _date(bars[first_index]),
            "base_end": _date(bars[low_index]), "contraction_depths": [round(value, 5) for value in depths],
            "contractions": [{"high_date": _date(bars[high[1]]), "high": high[2],
                              "low_date": _date(bars[low[1]]), "low": low[2],
                              "depth_pct": round(depth * 100, 2)}
                             for (high, low), depth in zip(selected, depths)],
            "pivot": pivot, "trigger_price": pivot, "last_low": last_low,
            "invalidation_price": stop, "stop_basis": "VCP_LAST_LOW_MINUS_HALF_ATR",
            "entry_min_price": pivot, "entry_max_price": round(pivot * 1.04, 4),
            "entry_expiry_sessions": 3,
            "distance_to_pivot_pct": round((close / pivot - 1) * 100, 3),
            "distance_to_stop_pct": round(risk * 100, 3), "dry_sessions": dry_count,
            "breakout_volume_ratio20": round(volume_ratio, 3),
            "average_turnover_20_vnd": round(turnover), "setup_age_sessions": age,
            "evidence_cluster": f"BASE_BREAKOUT:{setup_id}", "logic_revision": "VCP_SWING_20261016"}
