"""Display metadata for the existing funnel decision; no trading rule changes."""
from __future__ import annotations

from collections.abc import Sequence


def funnel_event_metadata(funnel: dict, session_dates: Sequence[str] = ()) -> dict:
    as_of = str(funnel["as_of_date"])
    trigger = funnel.get("trigger_date")
    sessions = sorted({str(day) for day in session_dates if str(day) <= as_of})
    age = None
    if trigger == as_of:
        age = 0
    elif trigger and trigger in sessions and as_of in sessions:
        age = sum(trigger < day <= as_of for day in sessions)
    return {"funnel_event_version": 1, "assessment_date": as_of,
            "setup_date": funnel.get("setup_date"), "trigger_date": trigger,
            "trigger_age_sessions": age, "trigger_age_basis": "VNINDEX_SESSIONS" if age is not None else None}
