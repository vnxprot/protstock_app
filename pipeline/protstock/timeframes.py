from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from typing import Sequence


def aggregate_bars(bars: Sequence[dict], timeframe: str) -> list[dict]:
    """Aggregate sorted daily OHLCV bars into point-in-time weekly/monthly bars."""
    if timeframe not in {"W", "M"}:
        raise ValueError("timeframe must be W or M")
    ordered = sorted(bars, key=lambda item: item["date"])
    groups: dict[date, list[dict]] = {}
    for bar in ordered:
        trading_date = date.fromisoformat(str(bar["date"])[:10])
        if timeframe == "W":
            period_start = trading_date - timedelta(days=trading_date.weekday())
        else:
            period_start = trading_date.replace(day=1)
        groups.setdefault(period_start, []).append(bar)

    last_daily_date = date.fromisoformat(str(ordered[-1]["date"])[:10]) if ordered else None
    if timeframe == "W" and last_daily_date is not None:
        last_period_start = last_daily_date - timedelta(days=last_daily_date.weekday())
    elif last_daily_date is not None:
        last_period_start = last_daily_date.replace(day=1)
    else:
        last_period_start = None
    result: list[dict] = []
    for period_start, rows in groups.items():
        if timeframe == "W":
            period_end = period_start + timedelta(days=4)
        else:
            period_end = period_start.replace(day=monthrange(period_start.year, period_start.month)[1])
        source_last_date = date.fromisoformat(str(rows[-1]["date"])[:10])
        result.append({
            "date": source_last_date.isoformat(),
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "open": float(rows[0]["open"]),
            "high": max(float(row["high"]) for row in rows),
            "low": min(float(row["low"]) for row in rows),
            "close": float(rows[-1]["close"]),
            "volume": sum(int(row.get("volume", 0)) for row in rows),
            "source_last_date": source_last_date.isoformat(),
            "is_complete": last_period_start is not None and period_start < last_period_start,
        })
    return result
