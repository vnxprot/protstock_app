"""Point-in-time research radar for a sustained price and volume move.

The radar describes detection and entry risk separately. It never publishes a
Champion order or treats matched volume as net buying flow.
"""

from __future__ import annotations

from datetime import date, timedelta
from hashlib import sha256
from statistics import mean
from typing import Sequence

from .signal_funnel import monthly_context
from .timeframes import aggregate_bars

VERSION = "MOMENTUM_RADAR_V1"


def assess_momentum_radar(
    symbol_id: int, daily_bars: Sequence[dict], *,
    confirmed_week_end: date | None = None,
    confirmed_month_end: date | None = None,
) -> dict:
    """Rebuild the current event from EOD bars without future information."""
    daily = sorted(daily_bars, key=lambda row: row["date"])
    if not daily:
        raise ValueError("No daily bars")
    as_of = daily[-1]["date"]
    base = {"symbol_id": symbol_id, "as_of_date": as_of, "version": VERSION,
            "event_id": None, "event_start_date": None, "breakout_date": None,
            "weekly_confirmed_date": None, "reacceleration_date": None,
            "breakout_level": None, "structural_stop": None,
            "stage": "NO_EVENT", "entry_status": "NO_ENTRY", "reasons": [], "evidence": {}}
    if any(float(left["close"]) <= 0 or float(right["close"]) / float(left["close"]) <= .5
           or float(right["close"]) / float(left["close"]) >= 2
           for left, right in zip(daily, daily[1:])):
        return {**base, "stage": "DATA_CHECK", "entry_status": "DATA_CHECK",
                "reasons": ["PRICE_DISCONTINUITY_UNVERIFIED"]}

    weeks = aggregate_bars(daily, "W", confirmed_week_end=confirmed_week_end)
    week_positions = {row["period_start"]: position for position, row in enumerate(weeks)}
    months = [row for row in aggregate_bars(daily, "M", confirmed_month_end=confirmed_month_end)
              if row["is_complete"]]
    month = monthly_context(months)
    event: dict | None = None
    latest_stage = "NO_EVENT"
    latest_reason = ""
    latest_metrics: dict = {}
    # An event older than one trading year is a new research campaign; keep
    # the per-symbol EOD cost bounded even for long stored histories.
    for index in range(max(0, len(daily) - 260), len(daily)):
        bar = daily[index]
        today = str(bar["date"])
        close = float(bar["close"])
        previous = daily[index - 1] if index else None
        prior20 = daily[index - 20:index] if index >= 20 else []
        average20 = mean(float(item["volume"]) for item in prior20) if prior20 else 0
        volume_ratio = float(bar["volume"]) / average20 if average20 else None
        daily_return = close / float(previous["close"]) - 1 if previous else None
        spread = float(bar["high"]) - float(bar["low"])
        close_location = (close - float(bar["low"])) / spread if spread > 0 else 0
        week_start = (date.fromisoformat(today) - timedelta(days=date.fromisoformat(today).weekday())).isoformat()
        week_position = week_positions[week_start]
        last13 = weeks[max(0, week_position - 13):week_position]
        level = max(float(row["high"]) for row in last13) if len(last13) == 13 else None
        prior5_high = max(float(row["high"]) for row in daily[max(0, index - 5):index]) if index else None
        surge = bool(daily_return is not None and daily_return >= .04
                     and volume_ratio is not None and volume_ratio >= 1.8 and close_location >= .6)
        breakout = bool(level is not None and previous is not None and len(prior20) == 20
                        and float(previous["close"]) <= level < close
                        and volume_ratio is not None and volume_ratio >= 1.3 and close_location >= .5)
        latest_metrics = {"close": round(close, 4), "volume": int(bar["volume"]),
                          "volume_average_20": round(average20) if average20 else None,
                          "volume_ratio_20": round(volume_ratio, 3) if volume_ratio is not None else None,
                          "daily_return_pct": round(daily_return * 100, 2) if daily_return is not None else None,
                          "close_location": round(close_location, 3),
                          "prior_5_day_high": round(prior5_high, 4) if prior5_high is not None else None,
                          "monthly_state": month["state"], "price_basis": "STORED_EOD"}

        if event is not None:
            if event["breakout_date"] is None and index - event["last_event_index"] > 10:
                event = None
            elif event["breakout_date"] is not None:
                below = close < event["breakout_level"]
                event["below_count"] = event["below_count"] + 1 if below else 0
                if close < event["structural_stop"] or event["below_count"] >= 2:
                    latest_stage, latest_reason = "INVALIDATED", "BREAKOUT_LOST"
                    event["milestones"].append({"date": today, "kind": "INVALIDATED", "close": close})
                    if index != len(daily) - 1:
                        event = None
                    else:
                        break

        if event is None and (surge or breakout):
            event = {"start": today, "last_event_index": index, "breakout_date": None,
                     "breakout_level": None, "structural_stop": None,
                     "weekly_confirmed_date": None, "reacceleration_date": None,
                     "below_count": 0, "milestones": []}
        if event is None:
            latest_stage, latest_reason = "NO_EVENT", ""
            continue

        latest_stage, latest_reason = ("CONTINUING", "TREND_ABOVE_BREAKOUT") if event["breakout_date"] else ("SURGE_WATCH", "EARLY_SURGE")
        if surge and event["breakout_date"] is None:
            latest_stage, latest_reason = "SURGE_WATCH", "EARLY_SURGE"
            event["last_event_index"] = index
            event["milestones"].append({"date": today, "kind": "SURGE_WATCH", "close": close,
                                        "volume_ratio_20": latest_metrics["volume_ratio_20"]})
        if breakout and event["breakout_date"] is None:
            current_week_lows = [float(row["low"]) for row in daily[:index + 1]
                                 if str(row["date"]) >= week_start]
            stop = min([float(row["low"]) for row in weeks[max(0, week_position - 3):week_position]] + current_week_lows)
            event.update({"breakout_date": today, "breakout_level": level,
                          "structural_stop": stop, "below_count": 0, "last_event_index": index})
            latest_stage, latest_reason = "DAILY_BREAKOUT", "DAILY_BREAKOUT_13W"
            event["milestones"].append({"date": today, "kind": "DAILY_BREAKOUT", "close": close,
                                        "level": level, "volume_ratio_20": latest_metrics["volume_ratio_20"]})

        current_week = weeks[week_position]
        if (event["breakout_date"] and current_week and current_week["is_complete"]
                and current_week["source_last_date"] == today and len(last13) == 13
                and close > event["breakout_level"]):
            average13 = mean(float(row["volume"]) for row in last13)
            if average13 and float(current_week["volume"]) >= 1.3 * average13:
                if event["weekly_confirmed_date"] is None:
                    event["weekly_confirmed_date"] = today
                    latest_stage, latest_reason = "WEEKLY_CONFIRMED", "WEEKLY_BREAKOUT_13_CONFIRMED"
                    event["milestones"].append({"date": today, "kind": "WEEKLY_CONFIRMED", "close": close,
                                                "weekly_volume_ratio_13": round(float(current_week["volume"]) / average13, 3)})
                elif today != event["weekly_confirmed_date"] and week_position and close > float(weeks[week_position - 1]["close"]):
                    event["milestones"].append({"date": today, "kind": "WEEKLY_CONTINUATION", "close": close})
        if (event["breakout_date"] and today != event["breakout_date"] and prior5_high is not None
                and close > prior5_high and volume_ratio is not None and volume_ratio >= 1.3):
            event["reacceleration_date"] = today
            latest_stage, latest_reason = "REACCELERATING", "FIVE_DAY_HIGH_VOLUME"
            event["milestones"].append({"date": today, "kind": "REACCELERATING", "close": close,
                                        "volume_ratio_20": latest_metrics["volume_ratio_20"]})

    if event is None:
        return {**base, "evidence": latest_metrics}
    event_id = sha256(f"{symbol_id}:MOMENTUM:{event['start']}".encode()).hexdigest()[:24]
    stop = event["structural_stop"]
    distance = (float(daily[-1]["close"]) / stop - 1) * 100 if stop else None
    entry_status = ("NO_ENTRY" if latest_stage == "INVALIDATED" else
                    "DATA_CHECK" if latest_stage == "DATA_CHECK" else
                    "EXTENDED" if distance is not None and distance > 8 else
                    "RISK_WINDOW" if latest_stage in {"DAILY_BREAKOUT", "WEEKLY_CONFIRMED", "REACCELERATING"}
                    and distance is not None and 0 <= distance <= 8 else "NO_ENTRY")
    return {**base, "event_id": event_id, "event_start_date": event["start"],
            "breakout_date": event["breakout_date"], "weekly_confirmed_date": event["weekly_confirmed_date"],
            "reacceleration_date": event["reacceleration_date"], "breakout_level": event["breakout_level"],
            "structural_stop": stop, "stage": latest_stage, "entry_status": entry_status,
            "reasons": [latest_reason] if latest_reason else [],
            "evidence": {**latest_metrics, "distance_to_stop_pct": round(distance, 2) if distance is not None else None,
                         "milestones": event["milestones"][-24:]}}
