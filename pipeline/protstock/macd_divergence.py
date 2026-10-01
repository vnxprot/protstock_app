"""Point-in-time detector for price/MACD bullish divergence.

The price pivot is
confirmed only after two later closed sessions.  MACD is sampled on that
price-pivot date so an unrelated oscillator low cannot be cherry-picked.
"""

from __future__ import annotations

from hashlib import sha256
from typing import Sequence

from .divergence import PIVOT_RADIUS
from .indicators import _ema_series


VERSION = "MACD_BULLISH_DIVERGENCE_V3"
MAX_SETUP_AGE = 60
MIN_SEPARATION = 5
MAX_SEPARATION = 45
MIN_PRICE_DECLINE = 0.005
MIN_MACD_RISE_PCT_POINTS = 0.2


def _macd_series(closes: list[float]) -> tuple[list[float | None], list[float | None]]:
    fast, slow = _ema_series(closes, 12), _ema_series(closes, 26)
    line = [None if a is None or b is None else a - b for a, b in zip(fast, slow)]
    signal = _ema_series([value for value in line if value is not None], 9)
    histogram = [None] * len(line)
    offset = next((index for index, value in enumerate(line) if value is not None), len(line))
    for index, value in enumerate(signal, offset):
        if value is not None and line[index] is not None:
            histogram[index] = line[index] - value
    return line, histogram


def _pivots(bars: Sequence[dict]) -> list[int]:
    return [index for index in range(PIVOT_RADIUS, len(bars) - PIVOT_RADIUS)
            if all(float(bars[index]["low"]) < float(bars[other]["low"])
                   for other in range(index - PIVOT_RADIUS, index + PIVOT_RADIUS + 1)
                   if other != index)]


def assess_macd_divergence(symbol_id: int, bars: Sequence[dict]) -> list[dict]:
    """Return the latest line/histogram setup for each of 1–3 segments.

    A sequence may skip higher price lows, but may not skip an
    intervening lower low or a lower oscillator trough.  This is a research
    definition whose thresholds must be frozen before prospective evaluation.
    """
    ordered = sorted(bars, key=lambda item: item["date"])
    if len(ordered) < 45:
        return []
    closes = [float(item["close"]) for item in ordered]
    line, histogram = _macd_series(closes)
    # MACD is proportional to the quoted share price. Compare recoveries as a
    # percent of that day's close so a low-priced and a high-priced stock face
    # the same threshold, and historical share rebases preserve the pattern.
    line = [None if value is None else 100 * value / close
            for value, close in zip(line, closes)]
    histogram = [None if value is None else 100 * value / close
                 for value, close in zip(histogram, closes)]
    pivots = _pivots(ordered)
    result = []
    for oscillator_name, values in (("MACD_LINE", line), ("MACD_HISTOGRAM", histogram)):
        pairs: list[tuple[int, int]] = []
        for right in pivots:
            if values[right] is None:
                continue
            for left in pivots:
                if not MIN_SEPARATION <= right - left <= MAX_SEPARATION or values[left] is None:
                    continue
                left_low, right_low = float(ordered[left]["low"]), float(ordered[right]["low"])
                if right_low > left_low * (1 - MIN_PRICE_DECLINE):
                    continue
                if values[right] - values[left] < MIN_MACD_RISE_PCT_POINTS:
                    continue
                between = [index for index in pivots if left < index < right]
                if any(float(ordered[index]["low"]) <= right_low for index in between):
                    continue
                if any(values[index] is not None and values[index] < values[left] - MIN_MACD_RISE_PCT_POINTS
                       for index in between):
                    continue
                pairs.append((left, right))
        if not pairs:
            continue
        # Build the longest valid chain ending at each pivot, then expose the
        # latest 2-, 3- and 4-pivot windows independently.
        best: dict[int, list[int]] = {}
        for left, right in sorted(pairs, key=lambda pair: (pair[1], pair[0])):
            chain = [*(best.get(left) or [left]), right]
            if len(chain) > len(best.get(right, [])):
                best[right] = chain[-4:]
        for swings in (2, 3, 4):
            candidates = (candidate for candidate in best.values() if len(candidate) >= swings)
            longest = max(candidates, key=lambda candidate: (candidate[-1], len(candidate)), default=None)
            if longest is None:
                continue
            chain = longest[-swings:]
            last = chain[-1]
            trigger = max(float(item["high"]) for item in ordered[chain[-2] + 1:last])
            stop = float(ordered[last]["low"])
            confirmed_on = last + PIVOT_RADIUS
            invalidated = False
            trigger_index = None
            for index in range(confirmed_on + 1, len(ordered)):
                if float(ordered[index]["low"]) < stop:
                    invalidated = True
                    break
                if (trigger_index is None and float(ordered[index]["close"]) > trigger
                        and float(ordered[index - 1]["close"]) <= trigger):
                    trigger_index = index
            age = len(ordered) - 1 - confirmed_on
            stage = ("INVALIDATED" if invalidated else "CONFIRMED" if trigger_index is not None
                     else "EXPIRED" if age > MAX_SETUP_AGE else "WATCH_PRICE_CONFIRMATION")
            setup_id = sha256(f"{symbol_id}:{oscillator_name}:{','.join(str(ordered[i]['date']) for i in chain)}".encode()).hexdigest()[:24]
            result.append({
            "symbol_id": symbol_id, "as_of_date": ordered[-1]["date"], "version": VERSION,
            "oscillator": oscillator_name, "swings": len(chain), "setup_id": setup_id,
            "stage": stage, "confirmed_on": ordered[confirmed_on]["date"],
            "trigger_date": ordered[trigger_index]["date"] if trigger_index is not None else None,
            "trigger_price": round(trigger, 4), "invalidation_price": round(stop, 4),
            "evidence": {"pivots": [{"date": ordered[index]["date"],
                                     "price_low": round(float(ordered[index]["low"]), 4),
                                     "oscillator": round(float(values[index]), 6)} for index in chain],
                         "price_basis": "INTRADAY_LOW", "oscillator_basis": "MACD_PCT_OF_CLOSE",
                         "pivot_confirmation_bars": PIVOT_RADIUS,
                         "source_bar_date": ordered[-1]["date"]},
            })
    return result
