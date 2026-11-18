from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import sys
from typing import Any

from .market_http import SourceUnavailable, request_json
from .market_sources import KBS_BASE, VCI_CHART, vci_candles
from .models import DailyBar

KBS_SOURCE_VERSION = "KBS_PUBLIC_V2_20260930"
VCI_SOURCE_VERSION = "VCI_DIRECT_V1"
STOCK_PRICE_UNIT = "THOUSAND_VND_PER_SHARE"
INDEX_PRICE_UNIT = "INDEX_POINTS"


class ProviderDataError(ValueError):
    """A vendor candle fails market-data validation."""


class MarketDataProvider:
    """VCI first; operational failures may select a complete KBS window."""
    API_BASE = KBS_BASE

    def __init__(self, source: str = "AUTO") -> None:
        self.source = source.upper()
        if self.source not in {"AUTO", "VCI", "KBS"}:
            raise ValueError("source must be AUTO, VCI, or KBS")

    def history(self, symbol: str, start: date, end: date) -> list[DailyBar]:
        if self.source == "KBS":
            return self._kbs_history(symbol, start, end)
        try:
            return self._vci_history(symbol, start, end)
        except (SourceUnavailable, ProviderDataError) as error:
            if self.source != "AUTO":
                raise
            print(f"SOURCE_FALLBACK:{symbol}:VCI->KBS:{error}", file=sys.stderr, flush=True)
            return self._kbs_history(symbol, start, end)

    def _vci_history(self, symbol: str, start: date, end: date) -> list[DailyBar]:
        records = vci_candles(symbol, start, end)
        scale = 1 if symbol.upper().endswith("INDEX") else 1000
        collected_at = datetime.now(timezone.utc)
        result, invalid = [], []
        for record in records:
            day = _to_date(record["t"])
            bar = DailyBar.create(symbol=symbol, trading_date=day,
                open=record["o"] / scale, high=record["h"] / scale,
                low=record["l"] / scale, close=record["c"] / scale,
                volume=int(record["v"]), source="VCI_DIRECT", collected_at=collected_at)
            problems = bar.validate()
            if problems:
                invalid.append((day, problems))
            else:
                result.append(bar)
        if invalid:
            latest_valid = max((bar.trading_date for bar in result), default=None)
            latest_invalid = max(day for day, _ in invalid)
            if latest_valid is None or latest_invalid > latest_valid:
                raise ProviderDataError(f"Invalid latest VCI bar for {symbol} on {latest_invalid}")
            print(f"VCI_INVALID_SESSIONS_SKIPPED:{symbol}:" + ",".join(day.isoformat() for day, _ in invalid), file=sys.stderr)
        return result

    def _kbs_history(self, symbol: str, start: date, end: date) -> list[DailyBar]:
        endpoint = "index" if symbol.upper().endswith("INDEX") else "stocks"
        # KBS stock OHLC is VND/share, while Prot stores stock OHLC in
        # thousand VND/share. Index values are points and must not be scaled.
        stock_price_scale = 1_000 if endpoint == "stocks" else 1
        payload = request_json("GET",
            f"{self.API_BASE}/{endpoint}/{symbol.upper()}/data_day",
            # KBS omitted the 25/09/2026 Friday bar when edate was the 25th
            # or 26th, but returned it with the 27th. Request a small buffer
            # and then enforce our inclusive end date locally.
            params={"sdate": start.strftime("%d-%m-%Y"), "edate": (end + timedelta(days=2)).strftime("%d-%m-%Y")},
        )
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
