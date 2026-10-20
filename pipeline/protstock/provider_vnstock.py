from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import sys
from time import sleep
from typing import Any

import httpx

from .models import DailyBar

KBS_SOURCE_VERSION = "KBS_PUBLIC_V2_20260930"
VCI_SOURCE_VERSION = "VNSTOCK_V5_VCI"
STOCK_PRICE_UNIT = "THOUSAND_VND_PER_SHARE"
INDEX_PRICE_UNIT = "INDEX_POINTS"


class ProviderDataError(ValueError):
    """The vendor returned an OHLCV bar that cannot be used in a price series."""


def _is_minute_quota(exc: Exception) -> bool:
    message = str(exc).lower()
    return type(exc).__name__ == "EntitlementError" and any(
        marker in message for marker in ("per-minute quota", "per minute quota", "hạn mức theo phút")
    )


class VnstockProvider:
    """Vnstock v5 VCI EOD prices with a labelled KBS fallback.

    A returned history always comes from one provider.  Callers must not append
    its bars to a persisted history from another provider without rebasing the
    whole calculation window first.
    """

    API_BASE = "https://kbbuddywts.kbsec.com.vn/iis-server/investment"

    def __init__(self, source: str = "AUTO") -> None:
        self.source = source.upper()
        if self.source not in {"AUTO", "VCI", "KBS"}:
            raise ValueError("source must be AUTO, VCI, or KBS")

    def history(self, symbol: str, start: date, end: date) -> list[DailyBar]:
        if self.source == "KBS":
            return self._kbs_history(symbol, start, end)
        if self.source == "VCI":
            return self._vci_history(symbol, start, end)
        # AUTO selects VCI for a new series. EOD explicitly selects the stored
        # series' vendor before calling here; errors never silently change it.
        return self._vci_history(symbol, start, end)

    def _vci_history(self, symbol: str, start: date, end: date) -> list[DailyBar]:
        from vnstock import Market, __version__ as vnstock_version

        if not str(vnstock_version).startswith("5."):
            raise RuntimeError("Vnstock generation 5 is required for VCI OHLCV")
        market = Market().index(symbol) if symbol.upper().endswith("INDEX") else Market().equity(symbol)
        collected_at = datetime.now(timezone.utc)
        result: list[DailyBar] = []
        invalid: list[tuple[date, list[str]]] = []
        # VCI can silently cap one OHLCV response at 1,000 sessions. Fetch
        # calendar-year windows so the requested 2021+ series stays complete.
        window_start = start
        while window_start <= end:
            window_end = min(end, window_start + timedelta(days=364))
            for attempt in range(3):
                try:
                    frame = market.ohlcv(
                        start=window_start.isoformat(), end=window_end.isoformat(), source="vci", floating=None,
                    )
                    break
                except Exception as exc:
                    if not _is_minute_quota(exc) or attempt == 2:
                        raise
                    # Keep already fetched years and wait for the free minute
                    # allowance to reset before retrying this single window.
                    sleep(65)
            actual_source = str(frame.attrs.get("source") or "").lower()
            if actual_source != "vci":
                raise RuntimeError(f"VCI request returned unexpected source: {actual_source or 'unknown'}")
            for row in frame.itertuples(index=False):
                timestamp = getattr(row, "time")
                trading_day = _to_date(timestamp)
                if not window_start <= trading_day <= window_end:
                    continue
                bar = DailyBar.create(
                    symbol=symbol, trading_date=trading_day,
                    open=getattr(row, "open"), high=getattr(row, "high"),
                    low=getattr(row, "low"), close=getattr(row, "close"),
                    volume=int(getattr(row, "volume")), source=f"VCI_VNSTOCK_{vnstock_version}",
                    collected_at=collected_at,
                )
                problems = bar.validate()
                if problems:
                    invalid.append((trading_day, problems))
                    continue
                result.append(bar)
            window_start = window_end + timedelta(days=1)
        if invalid:
            latest_valid = max((bar.trading_date for bar in result), default=None)
            latest_invalid = max(day for day, _ in invalid)
            if latest_valid is None or latest_invalid > latest_valid:
                raise ProviderDataError(f"Invalid latest VCI bar for {symbol} on {latest_invalid}: "
                                        f"{next(problems for day, problems in invalid if day == latest_invalid)}")
            print(f"VCI_INVALID_SESSIONS_SKIPPED:{symbol}:"
                  f"{','.join(day.isoformat() for day, _ in invalid)}", file=sys.stderr)
        by_date = {bar.trading_date: bar for bar in result}
        return [by_date[day] for day in sorted(by_date)]

    def _kbs_history(self, symbol: str, start: date, end: date) -> list[DailyBar]:
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
