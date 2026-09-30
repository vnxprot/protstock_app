"""Point-in-time monthly context, weekly setup and daily trigger research lane."""

from __future__ import annotations

from datetime import date
from hashlib import sha256
from statistics import mean
from typing import Sequence

from .indicators import _ema_series
from .timeframes import aggregate_bars

FUNNEL_VERSION = "MTF_FUNNEL_SHADOW_V1"
SETUP_TTL_SESSIONS = 20


def monthly_context(closed_months: Sequence[dict]) -> dict:
    """Require persistent structure; a single monthly close cannot flip the regime."""
    closes = [float(bar["close"]) for bar in closed_months]
    if len(closes) < 23:
        return {"state": "UNKNOWN", "reasons": ["MONTHLY_HISTORY_SHORT"]}
    ema = _ema_series(closes, 10)
    sma20 = mean(closes[-20:])
    prior_sma20 = mean(closes[-23:-3])
    up = (closes[-1] > ema[-1] > sma20 and closes[-2] > ema[-2]
          and ema[-1] > ema[-4] and sma20 > prior_sma20)
    down = (closes[-1] < ema[-1] < sma20 and closes[-2] < ema[-2]
            and ema[-1] < ema[-4] and sma20 < prior_sma20)
    state = "UP" if up else "DOWN" if down else "SIDEWAYS"
    return {"state": state, "reasons": [f"MONTHLY_STRUCTURE_{state}"],
            "ema10": round(ema[-1], 4), "sma20": round(sma20, 4),
            "ema10_slope_3m": round(ema[-1] / ema[-4] - 1, 6),
            "sma20_slope_3m": round(sma20 / prior_sma20 - 1, 6)}


def _weekly_candidates(closed_weeks: Sequence[dict]) -> list[dict]:
    candidates = []
    for i in range(20, len(closed_weeks)):
        bar = closed_weeks[i]
        prior = closed_weeks[i - 13:i]
        volume_average = mean(float(item["volume"]) for item in prior)
        if not volume_average:
            continue
        breakout_level = max(float(item["high"]) for item in prior)
        if float(bar["close"]) > breakout_level and float(bar["volume"]) >= 1.3 * volume_average:
            candidates.append({"kind": "WEEKLY_BREAKOUT_13", "date": bar["date"],
                               "trigger": breakout_level, "invalidation": min(float(item["low"]) for item in closed_weeks[i - 3:i + 1])})
        ema20 = _ema_series([float(item["close"]) for item in closed_weeks[:i + 1]], 20)[-1]
        if float(bar["low"]) <= ema20 < float(bar["close"]) and float(bar["close"]) > float(bar["open"]):
            candidates.append({"kind": "WEEKLY_PULLBACK_EMA20", "date": bar["date"],
                               "trigger": float(bar["high"]), "invalidation": min(float(item["low"]) for item in closed_weeks[i - 3:i + 1])})
    return candidates


def assess_funnel(symbol_id: int, daily_bars: Sequence[dict], *,
                  confirmed_week_end: date | None = None,
                  confirmed_month_end: date | None = None) -> dict:
    """Evaluate the last session using only closed higher timeframes and known daily bars."""
    daily = sorted(daily_bars, key=lambda bar: bar["date"])
    if not daily:
        raise ValueError("No daily bars")
    as_of = daily[-1]["date"]
    if any(float(left["close"]) <= 0 or float(right["close"]) / float(left["close"]) <= 0.5
           or float(right["close"]) / float(left["close"]) >= 2
           for left, right in zip(daily, daily[1:])):
        return {"symbol_id": symbol_id, "as_of_date": as_of, "version": FUNNEL_VERSION,
                "monthly_state": "UNKNOWN", "stage": "DATA_QUARANTINED", "setup_id": None,
                "setup_kind": None, "setup_date": None, "trigger_date": None,
                "reasons": ["PRICE_DISCONTINUITY_UNVERIFIED"], "evidence": {}}
    months = [bar for bar in aggregate_bars(daily, "M", confirmed_month_end=confirmed_month_end) if bar["is_complete"]]
    weeks = [bar for bar in aggregate_bars(daily, "W", confirmed_week_end=confirmed_week_end) if bar["is_complete"]]
    monthly = monthly_context(months)
    assessment = {"symbol_id": symbol_id, "as_of_date": as_of, "version": FUNNEL_VERSION,
                  "monthly_state": monthly["state"], "stage": "MONTHLY_CONTEXT",
                  "setup_id": None, "setup_kind": None, "setup_date": None,
                  "trigger_date": None, "reasons": list(monthly["reasons"]),
                  "evidence": {"monthly": monthly}}
    if monthly["state"] != "UP":
        return assessment
    candidates = _weekly_candidates(weeks)
    for setup in reversed(candidates):
        setup_start = next((i for i, bar in enumerate(daily) if bar["date"] == setup["date"]), None)
        if setup_start is None or len(daily) - setup_start - 1 > SETUP_TTL_SESSIONS:
            continue
        after = daily[setup_start + 1:]
        if any(float(bar["close"]) < setup["invalidation"] for bar in after):
            continue
        setup_id = sha256(f"{symbol_id}:{setup['kind']}:{setup['date']}".encode()).hexdigest()[:24]
        assessment.update({"stage": "WEEKLY_READY", "setup_id": setup_id,
                           "setup_kind": setup["kind"], "setup_date": setup["date"],
                           "reasons": [*monthly["reasons"], "WEEKLY_SETUP_READY"],
                           "evidence": {"monthly": monthly, "weekly": setup}})
        for i in range(setup_start + 1, len(daily)):
            bar = daily[i]
            previous = daily[i - 1]
            volume_window = daily[max(0, i - 20):i]
            if len(volume_window) < 20:
                continue
            average_volume = mean(float(item["volume"]) for item in volume_window)
            if (average_volume and float(bar["close"]) > setup["trigger"]
                    and float(previous["close"]) <= setup["trigger"]
                    and float(bar["volume"]) >= 1.3 * average_volume):
                assessment["trigger_date"] = bar["date"]
                assessment["stage"] = "DAILY_TRIGGER" if bar["date"] == as_of else "TRIGGERED_EARLIER"
                assessment["reasons"] = [*monthly["reasons"], "WEEKLY_SETUP_READY", "DAILY_TRIGGER_CONFIRMED"]
                break
        return assessment
    assessment["reasons"].append("WEEKLY_SETUP_MISSING")
    return assessment
