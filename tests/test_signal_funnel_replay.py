from datetime import date, timedelta

from protstock.signal_funnel import assess_funnel, monthly_context
from protstock.funnel_replay import replay_symbol


def test_one_month_spike_does_not_create_uptrend() -> None:
    closes = [100.0] * 22 + [120.0]
    assert monthly_context([{"close": close} for close in closes])["state"] == "SIDEWAYS"
    steady = [100.0 + i for i in range(23)]
    assert monthly_context([{"close": close} for close in steady])["state"] == "UP"


def test_unexplained_price_scale_change_is_quarantined() -> None:
    bars = [
        {"date": "2026-09-14", "open": 12000, "high": 12000, "low": 12000,
         "close": 12000, "volume": 100},
        {"date": "2026-09-15", "open": 12, "high": 12, "low": 12,
         "close": 12, "volume": 100},
    ]
    assert assess_funnel(1, bars)["stage"] == "DATA_QUARANTINED"


def test_replay_never_scores_future_bars_as_of_earlier_date() -> None:
    start = date(2026, 1, 1)
    rows = [{"trading_date": (start + timedelta(days=i)).isoformat(),
             "open": 100, "high": 101, "low": 99, "close": 100,
             "volume": 1000, "quality_status": "VALID"} for i in range(50)]
    sessions = [date.fromisoformat(row["trading_date"]) for row in rows]
    assessments, outcomes = replay_symbol(1, rows, sessions, start, start + timedelta(days=10))
    assert len(assessments) == 11
    assert all(row["as_of_date"] <= "2026-01-11" for row in assessments)
    assert outcomes == []
