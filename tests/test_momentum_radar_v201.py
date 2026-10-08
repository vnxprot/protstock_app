from datetime import date, timedelta
from unittest.mock import patch

from protstock.momentum_radar import assess_momentum_radar
from protstock.signal_funnel import assess_funnel


def rising_bars() -> list[dict]:
    rows = []
    day = date(2026, 1, 5)
    while len(rows) < 105:
        if day.weekday() < 5:
            rows.append({"date": day.isoformat(), "open": 99, "high": 101,
                         "low": 98, "close": 100, "volume": 1000})
        day += timedelta(days=1)
    rows[-1] = {**rows[-1], "open": 100, "high": 106, "low": 99,
                "close": 105, "volume": 5000}
    return rows


def test_same_day_weekly_breakout_records_friday_daily_trigger() -> None:
    rows = rising_bars()
    friday = date.fromisoformat(rows[-1]["date"])
    assert friday.weekday() == 4
    with patch("protstock.signal_funnel.monthly_context", return_value={"state": "UP", "reasons": ["TEST_UP"]}):
        result = assess_funnel(7, rows, confirmed_week_end=friday)
        assert result["stage"] == "DAILY_TRIGGER"
        assert result["setup_date"] == rows[-1]["date"]
        assert result["trigger_date"] == rows[-1]["date"]
        next_day = friday + timedelta(days=3)
        continued = assess_funnel(7, [*rows, {**rows[-1], "date": next_day.isoformat(),
                                               "open": 105, "low": 104, "high": 108,
                                               "close": 107, "volume": 1800}])
        assert continued["stage"] == "TRIGGERED_EARLIER"
        assert continued["trigger_date"] == rows[-1]["date"]


def test_radar_keeps_one_event_and_separates_entry_risk() -> None:
    rows = rising_bars()
    friday = date.fromisoformat(rows[-1]["date"])
    first = assess_momentum_radar(7, rows, confirmed_week_end=friday)
    assert first["stage"] == "WEEKLY_CONFIRMED"
    assert first["breakout_date"] == rows[-1]["date"]
    assert first["entry_status"] == "RISK_WINDOW"
    monday = {**rows[-1], "date": (friday + timedelta(days=3)).isoformat(),
              "open": 105, "high": 108, "low": 104, "close": 107, "volume": 1800}
    second = assess_momentum_radar(7, [*rows, monday])
    assert second["event_id"] == first["event_id"]
    assert second["stage"] == "REACCELERATING"
    extended = assess_momentum_radar(7, [*rows, {**monday, "close": 120, "high": 121}])
    assert extended["entry_status"] == "EXTENDED"


def test_radar_rejects_unverified_price_scale_jump() -> None:
    rows = rising_bars()
    rows[-1] = {**rows[-1], "close": 1000, "high": 1000}
    result = assess_momentum_radar(7, rows)
    assert result["stage"] == "DATA_CHECK"
    assert result["entry_status"] == "DATA_CHECK"
