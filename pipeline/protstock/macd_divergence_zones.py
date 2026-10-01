"""Prospective price-zone / MACD-line bullish divergence detector.

Price lows and MACD lows are selected independently inside a short zone.  A
new low while that zone is still forming revises the zone instead of silently
discarding the opportunity.  All calculations use closed bars available on
the assessment date; historical assessments are never rewritten.
"""

from __future__ import annotations

from hashlib import sha256
from typing import Sequence

from .divergence import PIVOT_RADIUS
from .macd_divergence import _macd_series


VERSION = "MACD_BULLISH_DIVERGENCE_ZONE_V4"
MAX_SETUP_AGE = 60
MAX_ZONE_GAP = 5
MAX_ZONE_SPREAD = 0.01
MIN_SEPARATION = 5
MAX_SEPARATION = 45
STRONG_PRICE_DECLINE = 0.005
STRONG_MACD_RISE = 0.2  # percentage points of close
MIN_THIN_BREAKOUT_VOLUME = 1.3
RECENT_BREAKOUT_SESSIONS = 5


def _quote_tick(price: float, exchange: str | None) -> float:
    """Price is in thousand VND; adjusted histories may have sub-tick values."""
    if exchange == "HOSE":
        return 0.01 if price < 10 else 0.05 if price < 50 else 0.1
    if exchange in {"HNX", "UPCOM"}:
        return 0.1
    return max(0.01, price * 0.0005)


def _price_pivots(bars: Sequence[dict]) -> list[int]:
    """Accept equal-low plateaus, requiring at least one strict neighbor."""
    result = []
    for index in range(max(PIVOT_RADIUS, len(bars) - 240), len(bars) - PIVOT_RADIUS):
        low = float(bars[index]["low"])
        neighbors = [float(bars[other]["low"]) for other in range(index - PIVOT_RADIUS, index + PIVOT_RADIUS + 1)
                     if other != index]
        if all(low <= other + 1e-8 for other in neighbors) and any(low < other - 1e-8 for other in neighbors):
            result.append(index)
    return result


def _zones(bars: Sequence[dict], macd: list[float | None]) -> list[dict]:
    grouped: list[list[int]] = []
    for index in _price_pivots(bars):
        low = float(bars[index]["low"])
        if grouped:
            prior = grouped[-1]
            lows = [float(bars[item]["low"]) for item in prior]
            spread = (max([*lows, low]) - min([*lows, low])) / min([*lows, low])
            if index - prior[-1] <= MAX_ZONE_GAP and spread <= MAX_ZONE_SPREAD + 1e-9:
                prior.append(index)
                continue
        grouped.append([index])

    result = []
    for group in grouped:
        window = range(max(0, group[0] - PIVOT_RADIUS), min(len(bars), group[-1] + PIVOT_RADIUS + 1))
        valid = [index for index in window if macd[index] is not None]
        if not valid:
            continue
        price_index = min(group, key=lambda index: (float(bars[index]["low"]), -index))
        macd_index = min(valid, key=lambda index: macd[index])
        revisions = []
        running_low = float("inf")
        for index in group:
            low = float(bars[index]["low"])
            if low < running_low - 1e-8:
                revisions.append({"date": bars[index]["date"], "price_low": round(low, 4)})
                running_low = low
        result.append({
            "start": group[0], "end": group[-1], "price_index": price_index,
            "macd_index": macd_index, "confirmed_index": group[-1] + PIVOT_RADIUS,
            "start_date": bars[group[0]]["date"], "end_date": bars[group[-1]]["date"],
            "price_date": bars[price_index]["date"], "price_low": float(bars[price_index]["low"]),
            "macd_date": bars[macd_index]["date"], "macd_low": float(macd[macd_index]),
            "revisions": revisions,
        })
    return result


def _breakout_volume(bars: Sequence[dict], index: int) -> float | None:
    prior = [float(bar.get("volume") or 0) for bar in bars[max(0, index - 20):index]]
    average = sum(prior) / len(prior) if len(prior) == 20 else 0
    return round(float(bars[index].get("volume") or 0) / average, 3) if average else None


def assess_macd_zone_divergence(symbol_id: int, bars: Sequence[dict], exchange: str | None = None) -> list[dict]:
    """Latest 1/2/3-segment MACD-line setup, one row per length and date."""
    ordered = sorted(bars, key=lambda item: item["date"])
    if len(ordered) < 45:
        return []
    closes = [float(row["close"]) for row in ordered]
    raw_line, _ = _macd_series(closes)
    macd = [None if value is None or close <= 0 else 100 * value / close
            for value, close in zip(raw_line, closes)]
    zones = _zones(ordered, macd)
    pairs: list[tuple[int, int]] = []
    for right in range(len(zones)):
        later = zones[right]
        for left in range(right):
            earlier = zones[left]
            gap = later["price_index"] - earlier["price_index"]
            if not MIN_SEPARATION <= gap <= MAX_SEPARATION:
                continue
            minimum_decline = 2 * _quote_tick(earlier["price_low"], exchange)
            if earlier["price_low"] - later["price_low"] + 1e-8 < minimum_decline:
                continue
            if later["macd_low"] <= earlier["macd_low"] + 1e-8:
                continue
            between = zones[left + 1:right]
            if any(item["price_low"] <= later["price_low"] for item in between):
                continue
            if any(item["macd_low"] < earlier["macd_low"] for item in between):
                continue
            pairs.append((left, right))
    best: dict[int, list[int]] = {}
    for left, right in sorted(pairs, key=lambda pair: (pair[1], pair[0])):
        chain = [*(best.get(left) or [left]), right]
        if len(chain) > len(best.get(right, [])):
            best[right] = chain[-4:]

    results = []
    for swings in (2, 3, 4):
        candidates = (chain for chain in best.values() if len(chain) >= swings)
        latest = max(candidates, key=lambda chain: (zones[chain[-1]]["price_index"], len(chain)), default=None)
        if latest is None:
            continue
        chain = latest[-swings:]
        selected = [zones[index] for index in chain]
        last = selected[-1]
        trigger = max(float(row["high"]) for row in ordered[selected[-2]["price_index"] + 1:last["price_index"]])
        stop = last["price_low"]
        confirmed_index = last["confirmed_index"]
        expiry_index = confirmed_index + MAX_SETUP_AGE
        trigger_index = invalidated_index = pending_index = None
        for index in range(confirmed_index + 1, len(ordered)):
            if index > expiry_index and trigger_index is None:
                break
            if float(ordered[index]["low"]) < stop - 1e-8:
                if trigger_index is not None or index <= len(ordered) - PIVOT_RADIUS - 1:
                    invalidated_index = index
                else:
                    pending_index = index
                break
            if (trigger_index is None and float(ordered[index]["close"]) > trigger
                    and float(ordered[index - 1]["close"]) <= trigger):
                trigger_index = index
        age = len(ordered) - 1 - confirmed_index
        stage = ("INVALIDATED" if invalidated_index is not None else "CONFIRMED" if trigger_index is not None
                 else "EXPIRED" if age > MAX_SETUP_AGE else "WATCH_PRICE_CONFIRMATION")
        declines = [100 * (left["price_low"] - right["price_low"]) / left["price_low"]
                    for left, right in zip(selected, selected[1:])]
        rises = [right["macd_low"] - left["macd_low"] for left, right in zip(selected, selected[1:])]
        thin = any(decline < 100 * STRONG_PRICE_DECLINE or rise < STRONG_MACD_RISE
                   for decline, rise in zip(declines, rises))
        setup_id = sha256(f"{symbol_id}:MACD_LINE:{','.join(zone['start_date'] for zone in selected)}".encode()).hexdigest()[:24]
        zone_evidence = [{key: zone[key] for key in ("start_date", "end_date", "price_date", "macd_date", "revisions")}
                         | {"price_low": round(zone["price_low"], 4), "macd_low": round(zone["macd_low"], 6)}
                         for zone in selected]
        results.append({
            "symbol_id": symbol_id, "as_of_date": ordered[-1]["date"], "version": VERSION,
            "oscillator": "MACD_LINE", "swings": swings, "setup_id": setup_id,
            "stage": stage, "confirmed_on": ordered[confirmed_index]["date"],
            "trigger_date": ordered[trigger_index]["date"] if trigger_index is not None else None,
            "trigger_price": round(trigger, 4), "invalidation_price": round(stop, 4),
            "evidence": {
                "zones": zone_evidence, "price_basis": "INTRADAY_ZONE_LOW",
                "oscillator_basis": "MACD_LINE_PCT_OF_CLOSE", "pivot_confirmation_bars": PIVOT_RADIUS,
                "zone_max_gap_sessions": MAX_ZONE_GAP, "zone_max_spread_pct": 100 * MAX_ZONE_SPREAD,
                "price_declines_pct": [round(value, 3) for value in declines],
                "macd_rises_pct_points": [round(value, 3) for value in rises],
                "strength": "THIN" if thin else "ROBUST",
                "breakout_volume_ratio20": _breakout_volume(ordered, trigger_index) if trigger_index is not None else None,
                "trigger_age_sessions": len(ordered) - 1 - trigger_index if trigger_index is not None else None,
                "latest_close": round(closes[-1], 4),
                "distance_to_trigger_pct": round(100 * (trigger - closes[-1]) / trigger, 3),
                "pending_lower_low_on": ordered[pending_index]["date"] if pending_index is not None else None,
                "invalidated_on": ordered[invalidated_index]["date"] if invalidated_index is not None else None,
                "source_bar_date": ordered[-1]["date"],
            },
        })
    return results
