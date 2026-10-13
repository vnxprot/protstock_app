from __future__ import annotations

from datetime import date
from math import isclose
from time import sleep
from typing import Any, Iterable

from .config import Settings
from .history_coverage import assess_symbol_coverage
from .provider_vnstock import VnstockProvider, INDEX_PRICE_UNIT, KBS_SOURCE_VERSION
from .price_basis import canonical_price_rows, same_source_window, source_family, latest_coherent_revision
from .supabase_rest import SupabaseRestClient


def repair_missing_history(
    start_date: date,
    end_date: date,
    *,
    source: str = "AUTO",
    symbol_offset: int = 0,
    symbol_limit: int | None = None,
    symbols: set[str] | None = None,
    pause_seconds: float = 3.0,
    full_range: bool = False,
) -> dict[str, Any]:
    """Fill only missing daily sessions using VNINDEX as the trading calendar."""
    client = SupabaseRestClient(Settings.from_env())
    counts = {"symbols": 0, "already_complete": 0, "missing_sessions": 0, "rows_written": 0, "unresolved_sessions": 0, "pre_listing_sessions": 0, "unclassified_before_first_observation_sessions": 0, "failed": 0}
    unresolved: dict[str, int] = {}
    failures: dict[str, str] = {}
    try:
        if full_range:
            index = client.market_index("VNINDEX")
            calendar = set(client.index_price_dates(index["id"], start_date, end_date))
            index_bars = _fetch_from_source("VNINDEX", start_date, end_date, source)
            source_calendar = {bar.trading_date.isoformat() for bar in index_bars}
            missing_index_dates = source_calendar - calendar
            index_rows = _index_price_rows(index["id"], index_bars, missing_index_dates)
            if index_rows:
                client.upsert("market_index_prices", index_rows, "index_id,trading_date")
            calendar |= source_calendar
            if not calendar:
                raise RuntimeError("VNINDEX calendar is empty for the requested date range")
            selected = [row for row in client.active_symbols() if symbols is None or row["symbol"] in symbols]
            selected = selected[symbol_offset:]
            if symbol_limit is not None:
                selected = selected[:symbol_limit]
            unknown = (symbols or set()) - {row["symbol"] for row in client.active_symbols()}
            if unknown:
                raise ValueError(f"Unknown or inactive symbols: {', '.join(sorted(unknown))}")
            no_source_data: list[str] = []
            for symbol in selected:
                counts["symbols"] += 1
                try:
                    existing = set(client.symbol_price_dates(symbol["id"], start_date, end_date))
                    bars, rows = _canonical_repair_rows(client, symbol, start_date, end_date, source,
                                                         requested_session=end_date.isoformat() in calendar)
                    if not bars:
                        no_source_data.append(symbol["symbol"])
                        continue
                    missing = {bar.trading_date.isoformat() for bar in bars} - existing
                    counts["missing_sessions"] += len(missing)
                    stored = [row for row in client.price_history(symbol["id"],
                              max(260, (end_date - start_date).days + 300))
                              if start_date.isoformat() <= row["trading_date"] <= end_date.isoformat()]
                    rebase = bool(stored) and (
                        not same_source_window(stored)
                        or stored[-1].get("data_revision") != rows[-1]["data_revision"]
                        or source_family(stored[-1].get("source")) != source_family(rows[-1]["source"]))
                    write_rows = rows if rebase else [row for row in rows if row["trading_date"] in missing]
                    for offset in range(0, len(write_rows), 100):
                        counts["rows_written"] += client.upsert("daily_prices", write_rows[offset:offset + 100], "symbol_id,trading_date")
                    if not missing:
                        counts["already_complete"] += 1
                    coherent_stored = latest_coherent_revision(stored)
                    retained_dates = ({row["trading_date"] for row in coherent_stored}
                                      if rows and coherent_stored
                                      and coherent_stored[-1].get("data_revision") == rows[-1]["data_revision"]
                                      and source_family(coherent_stored[-1].get("source")) == source_family(rows[-1]["source"])
                                      else set())
                    coverage = assess_symbol_coverage(symbol, calendar,
                                                      retained_dates | {bar.trading_date.isoformat() for bar in bars}, start_date)
                    remaining = coverage["missing_after_coverage_start_count"]
                    counts["unresolved_sessions"] += remaining
                    counts["pre_listing_sessions"] += coverage["pre_listing_session_count"]
                    counts["unclassified_before_first_observation_sessions"] += coverage["unclassified_before_first_observation_count"]
                    if remaining:
                        unresolved[symbol["symbol"]] = remaining
                except Exception as exc:
                    counts["failed"] += 1
                    unresolved[symbol["symbol"]] = -1
                    failures[symbol["symbol"]] = f"{type(exc).__name__}: {str(exc)[:300]}"
                sleep(pause_seconds)
            return {"status": "SUCCEEDED" if not counts["failed"] and not no_source_data and not counts["unresolved_sessions"] and not counts["unclassified_before_first_observation_sessions"] else "PARTIAL", "start_date": start_date.isoformat(), "end_date": end_date.isoformat(), **counts, "no_source_data": no_source_data, "unresolved": unresolved, "failures": failures}
        index = client.market_index("VNINDEX")
        existing_index_dates = set(client.index_price_dates(index["id"], start_date, end_date))
        index_bars = _fetch_from_source("VNINDEX", start_date, end_date, source)
        source_calendar = {bar.trading_date.isoformat() for bar in index_bars}
        missing_index_dates = source_calendar - existing_index_dates
        index_rows = _index_price_rows(index["id"], index_bars, missing_index_dates)
        index_rows_written = client.upsert("market_index_prices", index_rows, "index_id,trading_date") if index_rows else 0
        calendar = source_calendar or existing_index_dates
        if not calendar:
            raise RuntimeError("VNINDEX calendar is empty for the requested date range")
        active_symbols = client.active_symbols()
        if symbols is not None:
            active_symbols = [row for row in active_symbols if row["symbol"] in symbols]
        symbols = active_symbols[symbol_offset:]
        if symbol_limit is not None:
            symbols = symbols[:symbol_limit]
        for symbol in symbols:
            counts["symbols"] += 1
            missing_for_symbol = 0
            try:
                existing = set(client.symbol_price_dates(symbol["id"], start_date, end_date))
                coverage = assess_symbol_coverage(symbol, calendar, existing, start_date)
                counts["pre_listing_sessions"] += coverage["pre_listing_session_count"]
                counts["unclassified_before_first_observation_sessions"] += coverage["unclassified_before_first_observation_count"]
                missing = set(coverage["missing_after_coverage_start"])
                missing_for_symbol = len(missing)
                if not missing:
                    counts["already_complete"] += 1
                    continue
                counts["missing_sessions"] += len(missing)
                bars, rows = _canonical_repair_rows(client, symbol, start_date, end_date, source)
                for offset in range(0, len(rows), 100):
                    counts["rows_written"] += client.upsert("daily_prices", rows[offset:offset + 100], "symbol_id,trading_date")
                remaining = len(missing - {row["trading_date"] for row in rows})
                if remaining:
                    unresolved[symbol["symbol"]] = remaining
                    counts["unresolved_sessions"] += remaining
            except Exception:
                counts["failed"] += 1
                unresolved[symbol["symbol"]] = missing_for_symbol
                counts["unresolved_sessions"] += missing_for_symbol
            sleep(pause_seconds)
        return {"status": "SUCCEEDED" if counts["failed"] == 0 else "PARTIAL", "start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "vnindex": {"sessions": len(calendar), "missing_sessions": len(missing_index_dates), "rows_written": index_rows_written}, **counts, "unresolved": unresolved}
    finally:
        client.close()


def _fetch_from_source(symbol: str, start_date: date, end_date: date, source: str):
    return VnstockProvider(source).history(symbol, start_date, end_date)


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
            "price_unit": INDEX_PRICE_UNIT,
            "source_version": KBS_SOURCE_VERSION,
        })
    return rows

def _canonical_repair_rows(client: SupabaseRestClient, symbol: dict, start_date: date,
                           end_date: date, source: str, *, requested_session: bool = False) -> tuple[list, list[dict]]:
    """Refetch a whole persisted window so a missing session never mixes bases."""
    history_limit = max(260, (end_date - start_date).days + 300)
    stored = latest_coherent_revision(row for row in client.price_history(symbol["id"], history_limit)
                                      if start_date.isoformat() <= row["trading_date"] <= end_date.isoformat())
    first_day = start_date
    bars = _fetch_from_source(symbol["symbol"], first_day, end_date, source)
    available = {bar.trading_date.isoformat() for bar in bars}
    missing_stored = {row["trading_date"] for row in stored if row["trading_date"] >= first_day.isoformat()} - available
    if (missing_stored or (requested_session and (not bars or bars[-1].trading_date != end_date))) and source.upper() == "AUTO":
        fallback = _fetch_from_source(symbol["symbol"], first_day, end_date, "KBS")
        fallback_dates = {bar.trading_date.isoformat() for bar in fallback}
        fallback_missing = {row["trading_date"] for row in stored} - fallback_dates
        if fallback and not fallback_missing and (not requested_session or fallback[-1].trading_date == end_date):
            bars = fallback
        available = {bar.trading_date.isoformat() for bar in bars}
        missing_stored = {row["trading_date"] for row in stored if row["trading_date"] >= first_day.isoformat()} - available
    rows = canonical_price_rows(symbol["id"], bars, client.corporate_actions(symbol["id"]), as_of_date=end_date)
    if missing_stored:
        current = {row["trading_date"]: row for row in rows}
        mismatch_reason = "REVISION_OR_SOURCE"
        same_family = bool(rows and stored and
                           source_family(stored[-1].get("source")) == source_family(rows[-1]["source"]))
        revision_changed = same_family and stored[-1].get("data_revision") != rows[-1]["data_revision"]
        # An old revision omitted by the vendor stays stored for audit, but
        # calculations and chart RPCs select only the newly fetched revision.
        consistent = bool(revision_changed or (same_family and
                          stored[-1].get("data_revision") == rows[-1]["data_revision"]))
        if consistent and not revision_changed:
            for prior in stored:
                updated = current.get(prior["trading_date"])
                if updated is None:
                    continue
                if any(not isclose(float(prior[field]), float(updated[field]), rel_tol=0.001, abs_tol=0.01)
                       for field in ("open", "high", "low", "close")):
                    consistent = False
                    mismatch_reason = f"OHLC:{prior['trading_date']}"
                    break
        if not consistent:
            raise ValueError(f"SOURCE_HISTORY_COVERAGE_MISMATCH:{len(missing_stored)}:{mismatch_reason}")
    return bars, rows
