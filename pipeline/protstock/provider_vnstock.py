from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
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
        # KBS stock OHLC is VND/share, while Prot stores stock OHLC in
        # thousand VND/share. Index values are points and must not be scaled.
        stock_price_scale = 1_000 if endpoint == "stocks" else 1
        response = httpx.get(
            f"{self.API_BASE}/{endpoint}/{symbol.upper()}/data_day",
            # KBS omitted the 25/09/2026 Friday bar when edate was the 25th
            # or 26th, but returned it with the 27th. Request a small buffer
            # and then enforce our inclusive end date locally.
            params={"sdate": start.strftime("%d-%m-%Y"), "edate": (end + timedelta(days=2)).strftime("%d-%m-%Y")},
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
            if trading_day < start or trading_day > end:
                continue
            bar = DailyBar.create(
                symbol=symbol,
                trading_date=trading_day,
                open=_number(record, "o") / stock_price_scale,
                high=_number(record, "h") / stock_price_scale,
                low=_number(record, "l") / stock_price_scale,
                close=_number(record, "c") / stock_price_scale,
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
