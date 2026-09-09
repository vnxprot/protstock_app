from datetime import date, datetime, timezone

from protstock.bars import aggregate_bars, period_bounds
from protstock.models import DailyBar


def bar(day: int, close: int, volume: int = 100) -> DailyBar:
    return DailyBar.create(
        symbol="FPT",
        trading_date=date(2026, 9, day),
        open=close - 1,
        high=close + 2,
        low=close - 2,
        close=close,
        volume=volume,
        source="fixture",
        collected_at=datetime(2026, 9, day, 10, tzinfo=timezone.utc),
    )


def test_daily_bar_validation() -> None:
    assert bar(7, 100).validate() == []
    invalid = DailyBar.create(
        symbol="FPT",
        trading_date=date(2026, 9, 7),
        open=100,
        high=99,
        low=98,
        close=100,
        volume=-1,
        source="fixture",
    )
    assert set(invalid.validate()) == {"high_below_ohlc", "negative_volume"}


def test_weekly_aggregation_requires_explicit_completion() -> None:
    bars = [bar(7, 100), bar(8, 104, 200), bar(9, 102, 300)]
    start, end = period_bounds(date(2026, 9, 9), "W")
    forming = aggregate_bars(bars, "W")
    completed = aggregate_bars(bars, "W", completed_periods={start})

    assert end == date(2026, 9, 11)
    assert forming[0].is_complete is False
    assert completed[0].is_complete is True
    assert completed[0].open == 99
    assert completed[0].high == 106
    assert completed[0].low == 98
    assert completed[0].close == 102
    assert completed[0].volume == 600
