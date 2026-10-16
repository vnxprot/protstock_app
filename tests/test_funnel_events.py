from protstock.funnel_events import funnel_event_metadata
from protstock.funnel_dates_refresh import enriched_evidence


def test_age_counts_market_sessions_not_calendar_days():
    funnel = {"as_of_date": "2026-10-15", "setup_date": "2026-10-02", "trigger_date": "2026-10-09"}
    # Deliberately omit a holiday session as well as the weekend.
    metadata = funnel_event_metadata(funnel, ["2026-10-09", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"])
    assert metadata["trigger_age_sessions"] == 3
    assert metadata["setup_date"] == "2026-10-02"
    assert funnel_event_metadata(funnel)["trigger_age_sessions"] is None
    assert funnel_event_metadata({**funnel, "trigger_date": "2026-10-15"})["trigger_age_sessions"] == 0


def test_enrichment_preserves_evidence_and_refuses_different_decision():
    evidence = {"setup_id": "setup-a", "funnel_stage": "TRIGGERED_EARLIER", "monthly_state": "UP", "monthly": {"state": "UP"}, "weekly": {"trigger": 30}}
    record = {"action": "WATCH", "evidence": evidence}
    funnel = {"as_of_date": "2026-10-15", "setup_id": "setup-a", "stage": "TRIGGERED_EARLIER", "monthly_state": "UP", "setup_date": "2026-10-09", "trigger_date": "2026-10-12"}
    result = enriched_evidence(record, funnel, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"])
    assert result["monthly"] == evidence["monthly"]
    assert result["weekly"] == evidence["weekly"]
    assert result["trigger_age_sessions"] == 3
    assert "trigger_date" not in record["evidence"]
    assert record["action"] == "WATCH"
    assert enriched_evidence(record, {**funnel, "setup_id": "different"}, []) is None
    assert enriched_evidence(record, {**funnel, "stage": "DAILY_TRIGGER"}, []) is None
