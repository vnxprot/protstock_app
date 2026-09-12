from __future__ import annotations

from datetime import date
from typing import Any, Iterable

from .config import Settings
from .supabase_rest import SupabaseRestClient


def assess_symbol_coverage(
    symbol: dict[str, Any],
    calendar_dates: Iterable[str],
    existing_dates: Iterable[str],
    start_date: date,
) -> dict[str, Any]:
    """Classify gaps without treating an unverified listing gap as a defect."""
    calendar = sorted(set(calendar_dates))
    existing = set(existing_dates)
    listed_from = _iso_date(symbol.get("listed_from"))
    first_observed = min(existing) if existing else None
    requested_start = start_date.isoformat()

    if listed_from:
        coverage_start = max(requested_start, listed_from)
        basis = "LISTED_FROM"
    elif first_observed:
        coverage_start = max(requested_start, first_observed)
        basis = "FIRST_OBSERVED_BAR"
    else:
        coverage_start = requested_start
        basis = "NO_OBSERVED_DATA"

    expected = {session for session in calendar if session >= coverage_start}
    missing = sorted(expected - existing)
    pre_listing = [session for session in calendar if listed_from and session < max(requested_start, listed_from)]
    unclassified_before_first = [
        session for session in calendar
        if not listed_from and first_observed and requested_start <= session < first_observed
    ]
    return {
        "symbol": symbol["symbol"],
        "listed_from": listed_from,
        "first_observed_date": first_observed,
        "last_observed_date": max(existing) if existing else None,
        "coverage_start": coverage_start,
        "coverage_start_basis": basis,
        "observed_sessions": len(existing),
        "missing_after_coverage_start": missing,
        "missing_after_coverage_start_count": len(missing),
        "pre_listing_session_count": len(pre_listing),
        "unclassified_before_first_observation_count": len(unclassified_before_first),
    }


def build_history_coverage(
    symbols: Iterable[dict[str, Any]],
    calendar_dates: Iterable[str],
    dates_by_symbol: dict[int, Iterable[str]],
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    """Build a JSON-serialisable, per-symbol coverage report. Pure: no I/O."""
    calendar = sorted(set(calendar_dates))
    rows = [
        assess_symbol_coverage(symbol, calendar, dates_by_symbol.get(symbol["id"], ()), start_date)
        for symbol in symbols
    ]
    rows.sort(key=lambda row: (-row["missing_after_coverage_start_count"], row["symbol"]))
    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "calendar_sessions": len(calendar),
        "symbols": len(rows),
        "complete_after_coverage_start": sum(not row["missing_after_coverage_start_count"] for row in rows),
        "symbols_with_repairable_gaps": sum(bool(row["missing_after_coverage_start_count"]) for row in rows),
        "repairable_missing_sessions": sum(row["missing_after_coverage_start_count"] for row in rows),
        "pre_listing_sessions": sum(row["pre_listing_session_count"] for row in rows),
        "unclassified_before_first_observation_sessions": sum(
            row["unclassified_before_first_observation_count"] for row in rows
        ),
        "rows": rows,
    }


def audit_history_coverage(start_date: date, end_date: date) -> dict[str, Any]:
    """Read stored data and report coverage against the stored VNINDEX calendar."""
    client = SupabaseRestClient(Settings.from_env())
    try:
        index = client.market_index("VNINDEX")
        calendar = client.index_price_dates(index["id"], start_date, end_date)
        symbols = client.active_symbols()
        dates_by_symbol = {
            symbol["id"]: client.symbol_price_dates(symbol["id"], start_date, end_date)
            for symbol in symbols
        }
        return {
            "vnindex": {
                "first_session": min(calendar) if calendar else None,
                "last_session": max(calendar) if calendar else None,
                "sessions": len(set(calendar)),
            },
            **build_history_coverage(symbols, calendar, dates_by_symbol, start_date, end_date),
        }
    finally:
        client.close()


def _iso_date(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]
