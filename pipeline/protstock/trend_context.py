"""Canonical closed-month state machine and weekly setup evidence.

Policy is shared verbatim with Settings. Rebuild chronological state from the
same stored history, so live, research and backtest callers cannot seed their
hysteresis differently. No future monthly candle enters a historical state.
"""
from __future__ import annotations

import json
from functools import lru_cache
from math import expm1, isfinite, log, sqrt
from pathlib import Path
from statistics import mean, stdev
from typing import Sequence

from .indicators import _ema_series

POLICY = json.loads(Path(__file__).with_name("trend_policy.json").read_text(encoding="utf-8"))
TREND_VERSION = POLICY["version"]


def _period(bar: dict) -> str | None:
    return str(bar.get("period_end") or bar.get("date") or bar.get("trading_date") or "")[:10] or None


@lru_cache(maxsize=512)
def _monthly_states(closes: tuple[float, ...]) -> tuple[dict, ...]:
    ema = _ema_series(closes, POLICY["ema_months"])
    state = "UNKNOWN"
    states = []
    for i, close in enumerate(closes):
        if i + 1 < POLICY["minimum_months"]:
            states.append({"state": "UNKNOWN", "reasons": ["MONTHLY_HISTORY_SHORT"], "history_months": i + 1})
            continue
        moving = float(ema[i])
        slow = mean(closes[i + 1 - POLICY["sma_months"]:i + 1])
        indexes = range(i + 1 - POLICY["persistence_months"], i + 1)
        above = sum(closes[j] > float(ema[j]) for j in indexes)
        below = sum(closes[j] < float(ema[j]) for j in indexes)
        returns = [log(closes[j] / closes[j - 1]) for j in range(i + 1 - POLICY["volatility_months"], i + 1)]
        sigma = stdev(returns)
        y = [log(float(value)) for value in ema[i + 1 - POLICY["slope_months"]:i + 1]]
        center = (len(y) - 1) / 2
        beta = sum((j - center) * (value - mean(y)) for j, value in enumerate(y)) / sum((j - center) ** 2 for j in range(len(y)))
        slope = expm1(beta * POLICY["slope_horizon_months"])
        noise = sigma * sqrt(POLICY["slope_horizon_months"])
        entry = max(POLICY["entry_slope_floor"], POLICY["entry_volatility_multiplier"] * noise)
        hold = max(POLICY["hold_slope_floor"], POLICY["hold_volatility_multiplier"] * noise)
        broken = max(POLICY["break_floor"], POLICY["break_volatility_multiplier"] * sigma)
        wrong_up = all(closes[j] < float(ema[j]) for j in range(i + 1 - POLICY["wrong_side_months"], i + 1))
        wrong_down = all(closes[j] > float(ema[j]) for j in range(i + 1 - POLICY["wrong_side_months"], i + 1))
        up = {"price_above_ema": close > moving, "ema_above_sma": moving > slow,
              "persistence": above >= POLICY["entry_count"], "slope": slope >= entry}
        down = {"price_below_ema": close < moving, "ema_below_sma": moving < slow,
                "persistence": below >= POLICY["entry_count"], "slope": slope <= -entry}
        retain_up = (above >= POLICY["hold_count"] and moving >= slow and slope >= hold
                     and not wrong_up and close >= moving * (1 - broken))
        retain_down = (below >= POLICY["hold_count"] and moving <= slow and slope <= -hold
                       and not wrong_down and close <= moving * (1 + broken))
        previous = state
        if all(up.values()):
            state, reason = "UP", "MONTHLY_UP_ENTRY"
        elif all(down.values()):
            state, reason = "DOWN", "MONTHLY_DOWN_ENTRY"
        elif previous == "UP" and retain_up:
            state, reason = "UP", "MONTHLY_UP_HELD"
        elif previous == "DOWN" and retain_down:
            state, reason = "DOWN", "MONTHLY_DOWN_HELD"
        else:
            state, reason = "SIDEWAYS", "MONTHLY_NEUTRAL" if previous not in {"UP", "DOWN"} else "MONTHLY_TREND_LOST"
        states.append({"state": state, "previous_state": previous,
                       "reasons": [f"MONTHLY_STRUCTURE_{state}", reason], "history_months": i + 1,
                       "close": close, "previous_close": closes[i - 1], "ema10": moving, "previous_ema10": ema[i - 1],
                       "sma20": slow, "above_count": above, "below_count": below,
                       "ema10_slope_3m": slope, "monthly_volatility": sigma,
                       "entry_threshold": entry, "hold_threshold": hold, "break_threshold": broken,
                       "entry_up_checks": up, "entry_down_checks": down,
                       "hold_up": retain_up, "hold_down": retain_down})
    return tuple(states)


def monthly_timeline(closed_months: Sequence[dict]) -> list[dict]:
    bars = [bar for bar in closed_months if bar.get("is_complete", True)]
    closes = tuple(float(bar["close"]) for bar in bars)
    invalid = next((i for i, value in enumerate(closes) if not isfinite(value) or value <= 0), len(closes))
    result = []
    changed_on = None
    previous = "UNKNOWN"
    states = [*_monthly_states(closes[:invalid]), *({"state": "UNKNOWN", "reasons": ["MONTHLY_PRICE_INVALID"],
              "history_months": i + 1} for i in range(invalid, len(closes)))]
    for i, item in enumerate(states):
        if item["state"] != previous:
            changed_on = _period(bars[i])
        previous = item["state"]
        result.append({**item, "policy_version": TREND_VERSION, "period_end": _period(bars[i]),
                       "source_last_date": bars[i].get("source_last_date") or bars[i].get("date"),
                       "history_start": _period(bars[0]), "state_since": changed_on,
                       "persistence_start": _period(bars[max(0, i + 1 - POLICY["persistence_months"])]),
                       "slope_start": _period(bars[max(0, i + 1 - POLICY["slope_months"])])})
    return result


def monthly_context(closed_months: Sequence[dict]) -> dict:
    timeline = monthly_timeline(closed_months)
    return timeline[-1] if timeline else {"state": "UNKNOWN", "reasons": ["MONTHLY_HISTORY_SHORT"],
                                         "history_months": 0, "policy_version": TREND_VERSION}


def weekly_context(closed_weeks: Sequence[dict]) -> dict:
    bars = [bar for bar in closed_weeks if bar.get("is_complete", True)]
    closes = [float(bar["close"]) for bar in bars]
    minimum = POLICY["weekly_ema"] + POLICY["weekly_slope_weeks"]
    if len(bars) < minimum or any(not isfinite(value) or value <= 0 for value in closes):
        return {"range_confirmed": False, "strengthening": False, "reason": "WEEKLY_HISTORY_SHORT"}
    ema = _ema_series(closes, POLICY["weekly_ema"])
    slope = float(ema[-1]) / float(ema[-1 - POLICY["weekly_slope_weeks"]]) - 1
    window = bars[-POLICY["range_weeks"]:]
    high = max(float(bar["high"]) for bar in window)
    low = min(float(bar["low"]) for bar in window)
    width = high / low - 1 if low > 0 else float("inf")
    travel = sum(abs(float(right["close"]) - float(left["close"])) for left, right in zip(window, window[1:]))
    efficiency = abs(float(window[-1]["close"]) - float(window[0]["close"])) / travel if travel else 0.0
    return {"period_end": _period(bars[-1]), "ema20": ema[-1], "ema20_slope_4w": slope,
            "strengthening": closes[-1] > float(ema[-1]) and slope >= POLICY["weekly_up_slope"],
            "range_start": window[0].get("period_start") or _period(window[0]),
            "range_end": _period(window[-1]), "range_high": high, "range_low": low,
            "range_width": width, "range_efficiency": efficiency,
            "range_confirmed": width <= POLICY["range_width"] and abs(slope) <= POLICY["range_ema_slope"]
                               and efficiency <= POLICY["range_efficiency"], "policy_version": TREND_VERSION}
