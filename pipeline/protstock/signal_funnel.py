"""Point-in-time monthly context, weekly setup and daily trigger research lane."""

from __future__ import annotations

from datetime import date
from hashlib import sha256
from statistics import mean
from typing import Sequence

from .indicators import _ema_series
from .timeframes import aggregate_bars
from .price_basis import volume_window_is_comparable
from .trend_context import POLICY, monthly_context, weekly_context

FUNNEL_VERSION = "MTF_FUNNEL_SHADOW_V0_0_0_TREND1"
ADAPTIVE_FUNNEL_VERSION = "MTF_ADAPTIVE_CHALLENGER_V0_0_0_TREND1"
SETUP_TTL_SESSIONS = POLICY["setup_ttl_sessions"]


def adaptive_monthly_context(closed_months: Sequence[dict]) -> dict:
    """Compatibility adapter; both lanes share the full-history classifier."""
    return monthly_context(closed_months)


def _weekly_candidates(closed_weeks: Sequence[dict], adaptive: bool = False, earliest_date: str | None = None) -> list[dict]:
    candidates = []
    ema = _ema_series([float(bar["close"]) for bar in closed_weeks], POLICY["weekly_ema"])
    for i in range(20, len(closed_weeks)):
        bar = closed_weeks[i]
        if earliest_date is not None and str(bar["date"]) < earliest_date:
            continue
        prior = closed_weeks[i - 13:i]
        volume_average = (mean(float(item["volume"]) for item in prior)
                          if volume_window_is_comparable([*prior, bar]) else 0)
        if not volume_average:
            continue
        breakout_level = max(float(item["high"]) for item in prior)
        context = weekly_context(closed_weeks[:i + 1])
        if float(bar["close"]) > breakout_level and float(bar["volume"]) >= POLICY["volume_multiplier"] * volume_average:
            candidates.append({"kind": "WEEKLY_BREAKOUT_13", "date": bar["date"],
                               "trigger": breakout_level, "invalidation": min(float(item["low"]) for item in closed_weeks[i - 3:i + 1]),
                               "context": context})
        ema20 = ema[i]
        if context["strengthening"] and float(bar["low"]) <= ema20 < float(bar["close"]) and float(bar["close"]) > float(bar["open"]):
            candidates.append({"kind": "WEEKLY_PULLBACK_EMA20", "date": bar["date"],
                               "trigger": float(bar["high"]), "invalidation": min(float(item["low"]) for item in closed_weeks[i - 3:i + 1])})
        if adaptive:
            prior_context = weekly_context(closed_weeks[:i])
            support = min(float(item["low"]) for item in closed_weeks[i - POLICY["support_weeks"]:i])
            if (prior_context["range_confirmed"] and float(bar["low"]) <= support * (1 + POLICY["support_tolerance"]) and float(bar["close"]) > support
                    and float(bar["close"]) > float(bar["open"])):
                candidates.append({"kind": "WEEKLY_RANGE_SUPPORT", "date": bar["date"],
                                   "trigger": float(bar["high"]), "invalidation": float(bar["low"]), "context": prior_context})
    return candidates


def assess_funnel(symbol_id: int, daily_bars: Sequence[dict], *,
                  confirmed_week_end: date | None = None,
                  confirmed_month_end: date | None = None,
                  adaptive: bool = False, monthly_evidence: dict | None = None) -> dict:
    """Evaluate the last session using only closed higher timeframes and known daily bars."""
    daily = sorted(daily_bars, key=lambda bar: bar["date"])
    if not daily:
        raise ValueError("No daily bars")
    as_of = daily[-1]["date"]
    # A 100x/1000x jump is a unit error, not an ordinary corporate action.
    if any(float(left["close"]) <= 0 or float(right["close"]) / float(left["close"]) <= 0.1
           or float(right["close"]) / float(left["close"]) >= 10
           for left, right in zip(daily, daily[1:])):
        return {"symbol_id": symbol_id, "as_of_date": as_of, "version": ADAPTIVE_FUNNEL_VERSION if adaptive else FUNNEL_VERSION,
                "monthly_state": "UNKNOWN", "stage": "DATA_QUARANTINED", "setup_id": None,
                "setup_kind": None, "setup_date": None, "trigger_date": None,
                "reasons": ["PRICE_UNIT_DISCONTINUITY"], "evidence": {}}
    months = [bar for bar in aggregate_bars(daily, "M", confirmed_month_end=confirmed_month_end) if bar["is_complete"]]
    weeks = [bar for bar in aggregate_bars(daily, "W", confirmed_week_end=confirmed_week_end) if bar["is_complete"]]
    monthly = monthly_evidence if monthly_evidence is not None else (adaptive_monthly_context(months) if adaptive else monthly_context(months))
    assessment = {"symbol_id": symbol_id, "as_of_date": as_of, "version": ADAPTIVE_FUNNEL_VERSION if adaptive else FUNNEL_VERSION,
                  "monthly_state": monthly["state"], "stage": "MONTHLY_CONTEXT",
                  "setup_id": None, "setup_kind": None, "setup_date": None,
                  "trigger_date": None, "reasons": list(monthly["reasons"]),
                  "evidence": {"monthly": monthly, "weekly_context": weekly_context(weeks)}}
    if monthly["state"] != "UP" and not (adaptive and monthly["state"] == "SIDEWAYS"):
        return assessment
    candidates = _weekly_candidates(weeks, adaptive=adaptive,
        earliest_date=str(daily[max(0, len(daily) - SETUP_TTL_SESSIONS - 1)]["date"]))
    latest_ready = None
    triggered = []
    for setup in reversed(candidates):
        if monthly["state"] == "SIDEWAYS" and (setup["kind"] == "WEEKLY_PULLBACK_EMA20"
                or setup["kind"] == "WEEKLY_BREAKOUT_13" and not setup.get("context", {}).get("strengthening")):
            continue
        setup_start = next((i for i, bar in enumerate(daily) if bar["date"] == setup["date"]), None)
        if setup_start is None or len(daily) - setup_start - 1 > SETUP_TTL_SESSIONS:
            continue
        after = daily[setup_start + 1:]
        if any(float(bar["close"]) < setup["invalidation"] for bar in after):
            continue
        setup_id = sha256(f"{symbol_id}:{setup['kind']}:{setup['date']}".encode()).hexdigest()[:24]
        candidate_assessment = {**assessment, "stage": "WEEKLY_READY", "setup_id": setup_id,
                           "setup_kind": setup["kind"], "setup_date": setup["date"],
                           "reasons": [*monthly["reasons"], "WEEKLY_SETUP_READY"],
                           "evidence": {"monthly": monthly, "weekly": setup}}
        if latest_ready is None:
            latest_ready = candidate_assessment
        # A weekly breakout is only known at the week's close. Its final daily
        # candle can confirm the first crossing at that same EOD; requiring a
        # later recross makes a continuous breakout impossible to trigger.
        first_index = setup_start if setup["kind"] == "WEEKLY_BREAKOUT_13" else setup_start + 1
        for i in range(first_index, len(daily)):
            if i == 0:
                continue
            bar = daily[i]
            previous = daily[i - 1]
            volume_window = daily[max(0, i - 20):i]
            if len(volume_window) < 20:
                continue
            average_volume = (mean(float(item["volume"]) for item in volume_window)
                              if volume_window_is_comparable([*volume_window, bar]) else 0)
            range_rebound = adaptive and setup["kind"] == "WEEKLY_RANGE_SUPPORT"
            trigger = (float(previous["high"]) if range_rebound else setup["trigger"])
            if (average_volume and float(bar["close"]) > trigger
                    and float(previous["close"]) <= trigger
                    and (range_rebound or float(bar["volume"]) >= POLICY["volume_multiplier"] * average_volume)):
                candidate_assessment["trigger_date"] = bar["date"]
                candidate_assessment["stage"] = "DAILY_TRIGGER" if bar["date"] == as_of else "TRIGGERED_EARLIER"
                candidate_assessment["reasons"] = [*monthly["reasons"], "WEEKLY_SETUP_READY", "DAILY_TRIGGER_CONFIRMED"]
                triggered.append(candidate_assessment)
                break
    if triggered:
        newest_setup = max(item["setup_date"] for item in triggered)
        return min((item for item in triggered if item["setup_date"] == newest_setup),
                   key=lambda item: (item["trigger_date"],
                                     0 if item["setup_kind"] == "WEEKLY_BREAKOUT_13" else 1))
    if latest_ready is not None:
        return latest_ready
    assessment["reasons"].append("WEEKLY_SETUP_MISSING")
    return assessment
