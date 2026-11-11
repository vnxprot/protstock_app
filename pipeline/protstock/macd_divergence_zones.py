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
from .price_basis import volume_window_is_comparable


VERSION = "MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0"
MAX_SETUP_AGE = 60
MAX_ZONE_GAP = 5
MAX_ZONE_SPREAD = 0.01
MIN_SEPARATION = 5
MAX_SEPARATION = 60
STRONG_PRICE_DECLINE = 0.005
STRONG_MACD_RISE = 0.2  # percentage points of close
MIN_THIN_BREAKOUT_VOLUME = 1.3
RECENT_BREAKOUT_SESSIONS = 5


def get_tick_size(price: float, exchange: str | None, asset_type: str = "STOCK") -> float:
    """Tick size in thousand VND per the exchange rulebook.

    HOSE: ETF/CW → 0.01; stock <10 → 0.01; <50 → 0.05; ≥50 → 0.10
    HNX/UPCOM: ETF → 0.001; stock → 0.10
    Unknown: fallback to 0.05 (conservative mid-range)
    """
    if asset_type in {"ETF", "CW"}:
        return 0.01 if (exchange or "").upper() == "HOSE" else 0.001
    exch = (exchange or "").upper()
    if exch == "HOSE":
        if price < 10.0:
            return 0.01
        if price < 50.0:
            return 0.05
        return 0.10
    if exch in {"HNX", "UPCOM"}:
        return 0.10
    return 0.05


_quote_tick = get_tick_size  # backward-compatible alias


def _price_pivots(bars: Sequence[dict]) -> list[int]:
    """Include the last two provisional lows; they cannot confirm until two later closes."""
    result = []
    for index in range(max(PIVOT_RADIUS, len(bars) - 240), len(bars)):
        low = float(bars[index]["low"])
        if index + PIVOT_RADIUS >= len(bars) and low >= min(float(bars[other]["low"]) for other in range(index - PIVOT_RADIUS, index)) - 1e-8:
            continue
        neighbors = [float(bars[other]["low"]) for other in range(index - PIVOT_RADIUS, min(len(bars), index + PIVOT_RADIUS + 1))
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
    if index < 20 or not volume_window_is_comparable(bars[index - 20:index + 1]):
        return None
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
            minimum_decline = max(2 * get_tick_size(earlier["price_low"], exchange), earlier["price_low"] * 0.005)
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
        # --- Local trigger: near-term resistance when zone gap is wide (> 20 sessions) ---
        zone_gap = last["price_index"] - selected[-2]["price_index"]
        local_trigger_price: float | None = None
        local_trigger_date: str | None = None
        if zone_gap > 20:
            local_win_start = max(selected[-2]["price_index"] + 1, last["price_index"] - min(10, zone_gap // 3))
            local_win_end = last["price_index"]
            if local_win_start < local_win_end:
                local_bar = max(ordered[local_win_start:local_win_end], key=lambda b: float(b["high"]))
                _lp = float(local_bar["high"])
                if _lp < trigger - 1e-8:
                    local_trigger_price = _lp
                    local_trigger_date = local_bar["date"]
        # --- Trigger scan: start from day after bottom-2 so pre-confirmation surges are captured ---
        trigger_index = invalidated_index = pending_index = None
        scan_start = last["price_index"] + 1
        for index in range(scan_start, len(ordered)):
            if index > expiry_index and trigger_index is None:
                break
            bar_low = float(ordered[index]["low"])
            bar_close = float(ordered[index]["close"])
            prev_close = float(ordered[index - 1]["close"]) if index > 0 else 0.0
            if bar_low < stop - 1e-8:
                if trigger_index is not None or index <= len(ordered) - PIVOT_RADIUS - 1:
                    invalidated_index = index
                else:
                    pending_index = index
                break
            if trigger_index is None and bar_close > trigger:
                if index < confirmed_index:
                    # Pre-confirmation breakout: capture exact crossing bar
                    if prev_close <= trigger:
                        trigger_index = index
                else:
                    if prev_close <= trigger:
                        trigger_index = index
                    elif index == confirmed_index:
                        # Price already above trigger at confirmation day: backtrack to find first cross
                        for back in range(scan_start, confirmed_index + 1):
                            if float(ordered[back]["close"]) > trigger:
                                trigger_index = back
                                break
        age = len(ordered) - 1 - confirmed_index
        stage = ("WATCH_PIVOT_CONFIRMATION" if age < 0 else
                 "INVALIDATED" if invalidated_index is not None else "CONFIRMED" if trigger_index is not None
                 else "EXPIRED" if age > MAX_SETUP_AGE else "WATCH_PRICE_CONFIRMATION")
        pivot_bar = ordered[last["price_index"]]
        span = float(pivot_bar["high"]) - float(pivot_bar["low"])
        wick_ratio = (min(float(pivot_bar["open"]), float(pivot_bar["close"])) - float(pivot_bar["low"])) / span if span > 0 else 0
        close_location = (float(pivot_bar["close"]) - float(pivot_bar["low"])) / span if span > 0 else 0
        sweep_reversal = wick_ratio >= 0.45 and close_location >= 0.7
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
            "stage": stage, "confirmed_on": ordered[confirmed_index]["date"] if age >= 0 else None,
            "trigger_date": ordered[trigger_index]["date"] if trigger_index is not None else None,
            "trigger_price": round(trigger, 4), "invalidation_price": round(stop, 4),
            "evidence": {
                "zones": zone_evidence, "price_basis": "INTRADAY_ZONE_LOW",
                "oscillator_basis": "MACD_LINE_PCT_OF_CLOSE", "pivot_confirmation_bars": PIVOT_RADIUS,
                "zone_max_gap_sessions": MAX_ZONE_GAP, "zone_max_spread_pct": 100 * MAX_ZONE_SPREAD,
                "price_declines_pct": [round(value, 3) for value in declines],
                "macd_rises_pct_points": [round(value, 3) for value in rises],
                "strength": "THIN" if thin else "ROBUST",
                "sweep_reversal": sweep_reversal, "sweep_date": last["price_date"] if sweep_reversal else None,
                "lower_wick_ratio": round(wick_ratio, 3), "close_location": round(close_location, 3),
                "breakout_volume_ratio20": _breakout_volume(ordered, trigger_index) if trigger_index is not None else None,
                "trigger_age_sessions": len(ordered) - 1 - trigger_index if trigger_index is not None else None,
                "latest_close": round(closes[-1], 4),
                "distance_to_trigger_pct": round(100 * (trigger - closes[-1]) / trigger, 3),
                "pending_lower_low_on": ordered[pending_index]["date"] if pending_index is not None else None,
                "invalidated_on": ordered[invalidated_index]["date"] if invalidated_index is not None else None,
                "source_bar_date": ordered[-1]["date"],
                "gain_from_trough_pct": round(100 * (closes[-1] - stop) / stop, 2) if stop > 0 else None,
                "local_trigger_price": round(local_trigger_price, 4) if local_trigger_price is not None else None,
                "local_trigger_date": local_trigger_date,
            },
        })
    return results
