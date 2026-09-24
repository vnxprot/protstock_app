from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import httpx

from .models import DailyBar


class VnstockProvider:
    """Free, no-key adapter for KBS's public end-of-day OHLCV endpoint."""

    API_BASE = "https://kbbuddywts.kbsec.com.vn/iis-server/investment"

    def __init__(self, source: str = "KBS") -> None:
        self.source = source.upper()

    def history(self, symbol: str, start: date, end: date) -> list[DailyBar]:
        endpoint = "index" if symbol.upper().endswith("INDEX") else "stocks"
        response = httpx.get(
            f"{self.API_BASE}/{endpoint}/{symbol.upper()}/data_day",
            params={"sdate": start.strftime("%d-%m-%Y"), "edate": end.strftime("%d-%m-%Y")},
            headers={"Accept": "application/json", "User-Agent": "ProtStock/1.0"},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        records = payload.get("data_day") or []
        collected_at = datetime.now(timezone.utc)
        rows_by_date: dict[date, DailyBar] = {}
        for record in records:
            trading_day = _to_date(record.get("t") or record.get("time") or record.get("date"))
            bar = DailyBar.create(
                symbol=symbol,
                trading_date=trading_day,
                open=_number(record, "o"),
                high=_number(record, "h"),
                low=_number(record, "l"),
                close=_number(record, "c"),
                volume=int(_number(record, "v", default=0)),
                source="KBS_PUBLIC",
                collected_at=collected_at,
            )
            if not bar.validate():
                rows_by_date[trading_day] = bar
        return [rows_by_date[trading_day] for trading_day in sorted(rows_by_date)]


def _number(record: dict[str, Any], key: str, default: float | None = None) -> float:
    value = record.get(key, default)
    if value is None:
        raise ValueError(f"missing {key}")
    return float(value)


def _to_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])