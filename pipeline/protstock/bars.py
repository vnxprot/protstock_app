from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from calendar import monthrange
from collections.abc import Iterable

from .models import DailyBar


@dataclass(frozen=True)
class DerivedBar:
    symbol: str
    timeframe: str
    period_start: date
    period_end: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int
    source_last_date: date
    is_complete: bool


def period_bounds(value: date, timeframe: str) -> tuple[date, date]:
    if timeframe == "W":
        start = value - timedelta(days=value.weekday())
        return start, start + timedelta(days=4)
    if timeframe == "M":
        start = value.replace(day=1)
        return start, value.replace(day=monthrange(value.year, value.month)[1])
    raise ValueError("timeframe must be W or M")


def aggregate_bars(
    bars: Iterable[DailyBar],
    timeframe: str,
    completed_periods: set[date] | None = None,
) -> list[DerivedBar]:
    completed_periods = completed_periods or set()
    groups: dict[tuple[str, date], list[DailyBar]] = {}
    for bar in sorted(bars, key=lambda item: (item.symbol, item.trading_date)):
        start, _ = period_bounds(bar.trading_date, timeframe)
        groups.setdefault((bar.symbol, start), []).append(bar)

    result: list[DerivedBar] = []
    for (symbol, start), group in groups.items():
        _, end = period_bounds(start, timeframe)
        result.append(
            DerivedBar(
                symbol=symbol,
                timeframe=timeframe,
                period_start=start,
                period_end=end,
                open=group[0].open,
                high=max(item.high for item in group),
                low=min(item.low for item in group),
                close=group[-1].close,
                volume=sum(item.volume for item in group),
                source_last_date=group[-1].trading_date,
                is_complete=start in completed_periods,
            )
        )
    return result
