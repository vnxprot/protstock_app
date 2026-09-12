from __future__ import annotations

from datetime import date
from time import sleep
from typing import Any, Iterable

from .config import Settings
from .provider_vnstock import VnstockProvider
from .supabase_rest import SupabaseRestClient


def repair_missing_history(
    start_date: date,
    end_date: date,
    *,
    source: str = "KBS",
    symbol_offset: int = 0,
    symbol_limit: int | None = None,
    pause_seconds: float = 3.0,
) -> dict[str, Any]:
    """Fill only missing daily sessions using VNINDEX as the trading calendar."""
    client = SupabaseRestClient(Settings.from_env())
    counts = {"symbols": 0, "already_complete": 0, "missing_sessions": 0, "rows_written": 0, "unresolved_sessions": 0, "failed": 0}
    unresolved: dict[str, int] = {}
    try:
        index = client.market_index("VNINDEX")
        existing_index_dates = set(client.index_price_dates(index["id"], start_date, end_date))
        index_bars = _fetch_with_fallback("VNINDEX", start_date, end_date, source)
        source_calendar = {bar.trading_date.isoformat() for bar in index_bars}
        missing_index_dates = source_calendar - existing_index_dates
        index_rows = _index_price_rows(index["id"], index_bars, missing_index_dates)
        index_rows_written = client.upsert("market_index_prices", index_rows, "index_id,trading_date") if index_rows else 0
        calendar = source_calendar or existing_index_dates
        if not calendar:
            raise RuntimeError("VNINDEX calendar is empty for the requested date range")
        symbols = client.active_symbols()[symbol_offset:]
        if symbol_limit is not None:
            symbols = symbols[:symbol_limit]
        for symbol in symbols:
            counts["symbols"] += 1
            try:
                existing = set(client.symbol_price_dates(symbol["id"], start_date, end_date))
                missing = calendar - existing
                if not missing:
                    counts["already_complete"] += 1
                    continue
                counts["missing_sessions"] += len(missing)
                bars = _fetch_with_fallback(
                    symbol["symbol"], min(map(date.fromisoformat, missing)), max(map(date.fromisoformat, missing)), source
                )
                rows = _price_rows(symbol["id"], bars, missing)
                counts["rows_written"] += client.upsert("daily_prices", rows, "symbol_id,trading_date")
                remaining = len(missing - {row["trading_date"] for row in rows})
                if remaining:
                    unresolved[symbol["symbol"]] = remaining
                    counts["unresolved_sessions"] += remaining
            except Exception:
                counts["failed"] += 1
                unresolved[symbol["symbol"]] = len(calendar)
                counts["unresolved_sessions"] += len(calendar)
            sleep(pause_seconds)
        return {"status": "SUCCEEDED" if counts["failed"] == 0 else "PARTIAL", "start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "vnindex": {"sessions": len(calendar), "missing_sessions": len(missing_index_dates), "rows_written": index_rows_written}, **counts, "unresolved": unresolved}
    finally:
        client.close()


def _fetch_with_fallback(symbol: str, start_date: date, end_date: date, source: str):
    primary = source.upper()
    secondary = "VCI" if primary == "KBS" else "KBS"
    try:
        return VnstockProvider(primary).history(symbol, start_date, end_date)
    except Exception:
        return VnstockProvider(secondary).history(symbol, start_date, end_date)


def _index_price_rows(index_id: int, bars: Iterable, missing: set[str]) -> list[dict[str, Any]]:
    rows = []
    for bar in bars:
        trading_date = bar.trading_date.isoformat()
        if trading_date not in missing:
            continue
        rows.append({
            "index_id": index_id, "trading_date": trading_date,
            "open": float(bar.open), "high": float(bar.high), "low": float(bar.low), "close": float(bar.close),
            "volume": bar.volume, "source": bar.source, "collected_at": bar.collected_at.isoformat(),
        })
    return rows

def _price_rows(symbol_id: int, bars: Iterable, missing: set[str]) -> list[dict[str, Any]]:
    rows = []
    for bar in bars:
        trading_date = bar.trading_date.isoformat()
        if trading_date not in missing:
            continue
        rows.append({
            "symbol_id": symbol_id, "trading_date": trading_date,
            "open": float(bar.open), "high": float(bar.high), "low": float(bar.low), "close": float(bar.close),
            "volume": bar.volume, "source": bar.source, "collected_at": bar.collected_at.isoformat(), "quality_status": "VALID",
        })
    return rows