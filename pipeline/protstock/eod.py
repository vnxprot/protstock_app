from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from time import monotonic, sleep
from typing import Any

import httpx

from .analysis import ALGORITHM_VERSION, analyze_bars
from .decision_context import reconcile_proposal
from .fibonacci import build_fibonacci_context
from .config import Settings
from .engines import evaluate_named_engine, relative_strength_context_reasons
from .indicators import calculate_indicators
from .market_regime import build_breadth_membership
from .market_health_history import build_market_health_history
from .provider_vnstock import VnstockProvider
from .resolution import resolve_consolidated_signal
from .supabase_rest import SupabaseRestClient
from .timeframes import aggregate_bars
from .signal_policy import STOCK_PRICE_TO_VND, apply_signal_policy
from .period_signals import monthly_trend, evaluate_period_signal
from .wyckoff import classify_wyckoff_timeframe

# VNINDEX's first session was 28/07/2000. This keeps its benchmark history full
# through the app's operational planning horizon without expanding symbol fetches.
VNINDEX_HISTORY_START = date(2000, 7, 28)
BENCHMARK_LOOKBACK_DAYS = (date(2050, 1, 1) - VNINDEX_HISTORY_START).days
# Daily Fast Lane reuses the locally stored 260-session benchmark window. It only
# asks the upstream source for a small overlap to capture the newly closed session.
FAST_LANE_BENCHMARK_FETCH_DAYS = 14
# Daily, weekly and monthly analysis must share enough stored bars for SMA50 on monthly bars.
# 2,600 daily sessions cover roughly ten Vietnamese trading years without an upstream fetch.
MULTI_TIMEFRAME_HISTORY_LIMIT = 2600


def run_eod(
    trading_date: date,
    *,
    source: str = "KBS",
    lookback_days: int = 10,
    benchmark_lookback_days: int = BENCHMARK_LOOKBACK_DAYS,
    symbol_offset: int = 0,
    symbol_limit: int | None = None,
    # Shared GitHub Actions egress can consume multiple upstream requests per
    # symbol. Stay below 10 symbols/minute, comfortably inside guest limits.
    pause_seconds: float = 6.5,
    fast_lane: bool = False,
    write_breadth_snapshot: bool = True,
    historical: bool = False,
) -> dict[str, Any]:
    client = SupabaseRestClient(Settings.from_env())
    try:
        trading_date = resolve_eod_session(client, trading_date)
    except Exception:
        client.close()
        raise
    provider = VnstockProvider(source)
    fallback_source = "VCI" if source.upper() == "KBS" else "KBS"
    fallback_provider = VnstockProvider(fallback_source)
    job = client.create_job({
        "job_type": "EOD_INGEST", "trading_date": trading_date.isoformat(),
        "status": "RUNNING", "trigger_type": "MANUAL" if historical else "SCHEDULED",
        "source_revision": ALGORITHM_VERSION,
    })
    counts = {"symbols": 0, "prices": 0, "derived_bars": 0, "snapshots": 0, "patterns": 0, "zones": 0, "signals": 0, "consolidated_signals": 0, "breadth_snapshots": 0, "failed": 0}
    warnings: list[str] = []
    try:
        symbols = client.active_symbols()
        active_rules = client.active_rule_versions()
        counts["engine_stats"] = _initialize_engine_stats(active_rules)
        pending_signals = []
        benchmark_daily: list[dict] = []
        benchmark_history: list[dict] = []
        try:
            index = client.market_index("VNINDEX")
            benchmark_fetch_days = FAST_LANE_BENCHMARK_FETCH_DAYS if fast_lane else benchmark_lookback_days
            index_bars = provider.history("VNINDEX", trading_date - timedelta(days=benchmark_fetch_days), trading_date)
            index_rows = [{
                "index_id": index["id"], "trading_date": bar.trading_date.isoformat(),
                "open": float(bar.open), "high": float(bar.high), "low": float(bar.low),
                "close": float(bar.close), "volume": bar.volume, "source": bar.source,
                "collected_at": bar.collected_at.isoformat(),
            } for bar in index_bars]
            client.upsert("market_index_prices", index_rows, "index_id,trading_date")
            benchmark_history = client.index_price_history(index["id"], MULTI_TIMEFRAME_HISTORY_LIMIT)
            benchmark_daily = [
                {**row, "date": row["trading_date"]}
                for row in _rows_as_of(benchmark_history, trading_date)
            ]
            # A fresh database has no cached benchmark window. Self-heal once; all
            # later Fast Lane runs stay incremental.
            if fast_lane and len(benchmark_daily) < 200:
                index_bars = provider.history("VNINDEX", trading_date - timedelta(days=benchmark_lookback_days), trading_date)
                index_rows = [{
                    "index_id": index["id"], "trading_date": bar.trading_date.isoformat(),
                    "open": float(bar.open), "high": float(bar.high), "low": float(bar.low),
                    "close": float(bar.close), "volume": bar.volume, "source": bar.source,
                    "collected_at": bar.collected_at.isoformat(),
                } for bar in index_bars]
                client.upsert("market_index_prices", index_rows, "index_id,trading_date")
                benchmark_history = client.index_price_history(index["id"], MULTI_TIMEFRAME_HISTORY_LIMIT)
                benchmark_daily = [{**row, "date": row["trading_date"]} for row in _rows_as_of(benchmark_history, trading_date)]
        except Exception as exc:
            warnings.append(f"VNINDEX: {type(exc).__name__}")
        if symbols and (not benchmark_daily or benchmark_daily[-1]["date"] != trading_date.isoformat()):
            raise RuntimeError(f"VNINDEX EOD is unavailable for {trading_date}; signals were not published")
        confirmed_week_end = _confirmed_week_end(client, trading_date, benchmark_daily)
        confirmed_month_end = _confirmed_month_end(client, trading_date, benchmark_daily)
        symbols = symbols[symbol_offset:]
        if symbol_limit:
            symbols = symbols[:symbol_limit]
        for symbol_row in symbols:
            started = monotonic()
            try:
                fetched, used_fallback = _fetch_history_with_fallback(
                    provider,
                    fallback_provider,
                    symbol_row["symbol"],
                    trading_date - timedelta(days=lookback_days),
                    trading_date,
                )
                if used_fallback:
                    warnings.append(f"{symbol_row['symbol']}: fallback {source.upper()}->{fallback_source}")
                price_rows = [{
                    "symbol_id": symbol_row["id"], "trading_date": bar.trading_date.isoformat(),
                    "open": float(bar.open), "high": float(bar.high), "low": float(bar.low),
                    "close": float(bar.close), "volume": bar.volume, "source": bar.source,
                    "collected_at": bar.collected_at.isoformat(), "quality_status": "VALID",
                } for bar in fetched]
                counts["prices"] += client.upsert("daily_prices", price_rows, "symbol_id,trading_date")
                history = _rows_as_of(client.price_history(symbol_row["id"], MULTI_TIMEFRAME_HISTORY_LIMIT), trading_date)
                analysis_rows = [{**row, "date": row["trading_date"]} for row in history]
                if analysis_rows:
                    timeframe_rows = {"D": analysis_rows}
                    fibonacci_context = build_fibonacci_context(analysis_rows, confirmed_week_end, confirmed_month_end)
                    benchmark_rows = {"D": benchmark_daily}
                    for timeframe in ("W", "M"):
                        aggregated = aggregate_bars(analysis_rows, timeframe, confirmed_week_end, confirmed_month_end)
                        timeframe_rows[timeframe] = aggregated
                        benchmark_rows[timeframe] = aggregate_bars(benchmark_daily, timeframe, confirmed_week_end, confirmed_month_end)
                        derived_rows = [{
                            "symbol_id": symbol_row["id"], "timeframe": timeframe,
                            "period_start": bar["period_start"], "period_end": bar["period_end"],
                            "open": bar["open"], "high": bar["high"], "low": bar["low"],
                            "close": bar["close"], "volume": bar["volume"],
                            "is_complete": bar["is_complete"],
                            "source_last_date": bar["source_last_date"],
                        } for bar in aggregated]
                        counts["derived_bars"] += client.upsert(
                            "derived_bars", derived_rows, "symbol_id,timeframe,period_start"
                        )
                    decision_rows = {"D": analysis_rows, **{tf: [bar for bar in timeframe_rows[tf] if bar["is_complete"]] for tf in ("W", "M")}}
                    decision_benchmark = {"D": benchmark_daily, **{tf: [bar for bar in benchmark_rows[tf] if bar["is_complete"]] for tf in ("W", "M")}}
                    preliminary = {timeframe: analyze_bars(scoped_rows, fibonacci_context=fibonacci_context, timeframe=timeframe, include_classical=False) for timeframe, scoped_rows in decision_rows.items() if scoped_rows}
                    results = {timeframe: analyze_bars(scoped_rows, weekly_patterns=preliminary.get("W", {}).get("patterns", []), monthly_snapshot=preliminary.get("M", {}).get("indicators", {}), benchmark_rows=decision_benchmark[timeframe], fibonacci_context=fibonacci_context, timeframe=timeframe) for timeframe, scoped_rows in decision_rows.items() if scoped_rows}
                    context = {
                        "weekly_patterns": results.get("W", {}).get("patterns", []),
                        "weekly_classical_patterns": results.get("W", {}).get("classical_patterns", []),
                        "weekly_snapshot": results.get("W", {}).get("indicators", {}),
                        "monthly_snapshot": results.get("M", {}).get("indicators", {}),
                        "candidate_sector": symbol_row["sector"],
                    }
                    for timeframe, scoped_rows in decision_rows.items():
                        if timeframe in results:
                            if "period_events" not in context:
                                context.update(_decision_context(analysis_rows, trading_date, {}, confirmed_week_end, confirmed_month_end, results.get("W")))
                            if timeframe in {"W", "M"} and not context["period_events"][timeframe]:
                                continue
                            timeframe_context = {**context, "wyckoff_context": classify_wyckoff_timeframe(timeframe, scoped_rows, period_event=context["period_events"].get(timeframe, False))}
                            _write_analysis(client, symbol_row["id"], timeframe, scoped_rows, decision_benchmark[timeframe], active_rules, counts, results[timeframe], timeframe_context, evaluate_signals=False)
                            pending_signals.append((symbol_row["id"], timeframe, scoped_rows, decision_benchmark[timeframe], results[timeframe], timeframe_context))
                counts["symbols"] += 1
                client.create_job_item({
                    "job_run_id": job["id"], "symbol_id": symbol_row["id"],
                    "item_key": symbol_row["symbol"], "status": "SUCCEEDED",
                    "rows_written": len(price_rows), "duration_ms": int((monotonic() - started) * 1000),
                })
            except Exception as exc:  # a failed symbol must not stop the universe
                counts["failed"] += 1
                warnings.append(f"{symbol_row['symbol']}: {type(exc).__name__}")
                client.create_job_item({
                    "job_run_id": job["id"], "symbol_id": symbol_row["id"],
                    "item_key": symbol_row["symbol"], "status": "FAILED",
                    "error_code": type(exc).__name__, "error_message": str(exc)[:500],
                    "duration_ms": int((monotonic() - started) * 1000),
                })
            sleep(pause_seconds)
        if write_breadth_snapshot and symbols:
            # A retry/batch reads the complete stored universe, never its own subset.
            vnindex_snapshot = _benchmark_snapshot(benchmark_daily, trading_date)
            breadth = _persist_universe_breadth(client, trading_date, vnindex_snapshot["trend_state"])
            counts["breadth_snapshots"] += 1
            if breadth["coverage_status"] != "COMPLETE":
                warnings.append(f"BREADTH_DATA_{breadth['coverage_status']}: {breadth['observed_count']}/{breadth['eligible_count']} eligible")
            market_context = _same_day_market_context(trading_date, breadth, vnindex_snapshot)
            past_session = any(row["trading_date"] > trading_date.isoformat() for row in benchmark_history)
            portfolios = _load_portfolios(client, active_rules, trading_date, historical=historical or past_session)
            for symbol_id, timeframe, scoped_rows, index_rows, result, context in pending_signals:
                context["market_context"] = market_context
                context["portfolios"] = portfolios
                _write_analysis(client, symbol_id, timeframe, scoped_rows, index_rows, active_rules, counts, result, context, persist_evidence=False)
        status = "SUCCEEDED" if counts["failed"] == 0 else "PARTIAL"
        if status == "SUCCEEDED" and write_breadth_snapshot and symbol_offset == 0 and symbol_limit is None and benchmark_daily and benchmark_daily[-1]["date"] == trading_date.isoformat():
            counts["published_signals"] = client.consolidated_signal_count(trading_date, ALGORITHM_VERSION)
        _persist_engine_stats(client, job["id"], trading_date, counts)
        client.finish_job(job["id"], {"status": status, "finished_at": _now(), "counts": counts, "warnings": warnings})
        return {"job_id": job["id"], "status": status, **counts}
    except Exception as exc:
        client.finish_job(job["id"], {"status": "FAILED", "finished_at": _now(), "counts": counts, "error_summary": str(exc)[:500]})
        raise
    finally:
        client.close()


def finalize_fast_lane(trading_date: date, *, allow_partial: bool = False) -> dict[str, Any]:
    """Publish same-day market context from the available Fast Lane coverage."""
    client = SupabaseRestClient(Settings.from_env())
    try:
        trading_date = resolve_eod_session(client, trading_date)
        active_symbols = client.active_symbols()
        expected = {row["id"] for row in active_symbols}
        snapshots = client.daily_snapshots_for_date(trading_date)
        covered = {row["symbol_id"] for row in snapshots}
        missing = expected - covered
        if missing and not allow_partial:
            raise RuntimeError(f"Fast Lane incomplete: {len(covered)}/{len(expected)} daily snapshots")
        if not covered:
            raise RuntimeError(f"No same-day snapshots for {trading_date}; Market Health and signals cannot be evaluated")
        index = client.market_index("VNINDEX")
        benchmark = _rows_as_of(client.index_price_history(index["id"], MULTI_TIMEFRAME_HISTORY_LIMIT), trading_date)
        if not benchmark or benchmark[-1]["trading_date"] != trading_date.isoformat():
            raise RuntimeError(f"VNINDEX EOD is unavailable for {trading_date}; Fast Lane was not published")
        vnindex_snapshot = _benchmark_snapshot(benchmark, trading_date)
        breadth = _persist_universe_breadth(client, trading_date, vnindex_snapshot["trend_state"])
    finally:
        client.close()
    rebuilt = rebuild_signals(trading_date, prepared_market_context=_same_day_market_context(trading_date, breadth, vnindex_snapshot))
    if rebuilt["status"] != "SUCCEEDED":
        raise RuntimeError(f"Fast Lane signal evaluation was {rebuilt['status']}")
    return {
        "status": "PARTIAL" if missing else "SUCCEEDED",
        "covered": len(covered), "expected": len(expected),
        "missing_symbols": sorted(row["symbol"] for row in active_symbols if row["id"] in missing),
        "breadth": breadth, "signals": rebuilt["signals"],
        "published_signals": rebuilt.get("published_signals", 0),
    }


def rebuild_signals(trading_date: date, *, symbol_offset: int = 0, symbol_limit: int | None = None, historical: bool = False, prepared_market_context: dict | None = None) -> dict[str, Any]:
    """Re-evaluate stored EOD data only; this never calls an upstream price source."""
    client = SupabaseRestClient(Settings.from_env())
    try:
        trading_date = resolve_eod_session(client, trading_date)
    except Exception:
        client.close()
        raise
    job = client.create_job({"job_type": "DERIVE_BARS", "trading_date": trading_date.isoformat(), "status": "RUNNING", "trigger_type": "MANUAL", "source_revision": ALGORITHM_VERSION})
    counts = {"symbols": 0, "derived_bars": 0, "snapshots": 0, "patterns": 0, "zones": 0, "signals": 0, "consolidated_signals": 0, "breadth_snapshots": 0, "failed": 0}
    warnings: list[str] = []
    try:
        symbols = client.active_symbols()[symbol_offset:]
        if symbol_limit:
            symbols = symbols[:symbol_limit]
        active_rules = client.active_rule_versions()
        if not active_rules:
            # A signal-only run has nothing meaningful to do without an enabled
            # engine. Fail loudly rather than report a misleading success.
            raise RuntimeError(
                "No ACTIVE signal engines found. Enable a Core Engine or Rule Studio rule before rebuilding signals."
            )
        counts["engine_stats"] = _initialize_engine_stats(active_rules)
        pending_signals = []
        index = client.market_index("VNINDEX")
        benchmark_history = client.index_price_history(index["id"], MULTI_TIMEFRAME_HISTORY_LIMIT)
        benchmark_daily = [{**row, "date": row["trading_date"]} for row in _rows_as_of(benchmark_history, trading_date)]
        if not benchmark_daily or benchmark_daily[-1]["date"] != trading_date.isoformat():
            raise RuntimeError(f"VNINDEX EOD is unavailable for {trading_date}; signals were not published")
        confirmed_week_end = _confirmed_week_end(client, trading_date, benchmark_daily)
        confirmed_month_end = _confirmed_month_end(client, trading_date, benchmark_daily)
        if prepared_market_context and prepared_market_context.get("trading_date") != trading_date.isoformat():
            raise ValueError("prepared market context date differs from signal date")
        if prepared_market_context:
            past_session = any(row["trading_date"] > trading_date.isoformat() for row in benchmark_history)
            portfolios = _load_portfolios(client, active_rules, trading_date, historical=historical or past_session)
        for symbol_row in symbols:
            started = monotonic()
            try:
                analysis_rows = [{**row, "date": row["trading_date"]} for row in _rows_as_of(client.price_history(symbol_row["id"], MULTI_TIMEFRAME_HISTORY_LIMIT), trading_date)]
                if prepared_market_context is not None and (not analysis_rows or analysis_rows[-1]["date"] != trading_date.isoformat()):
                    # Partial publication uses only prices from this EOD.
                    counts["skipped_missing_price"] = counts.get("skipped_missing_price", 0) + 1
                    warnings.append(f"{symbol_row['symbol']}: STALE_PRICE_DATA")
                    for timeframe in ("D", "W", "M"):
                        client.delete_consolidated_signal(symbol_row["id"], timeframe, trading_date.isoformat())
                    client.create_job_item({"job_run_id": job["id"], "symbol_id": symbol_row["id"], "item_key": symbol_row["symbol"], "status": "SKIPPED", "warning_codes": ["STALE_PRICE_DATA"], "rows_written": 0, "duration_ms": int((monotonic() - started) * 1000)})
                    continue
                if not analysis_rows:
                    raise ValueError("no stored price history")
                timeframe_rows = {"D": analysis_rows, "W": aggregate_bars(analysis_rows, "W", confirmed_week_end), "M": aggregate_bars(analysis_rows, "M", confirmed_month_end=confirmed_month_end)}
                # A stored-price repair must also refresh the bars used by the
                # W/M charts, not just snapshots and signals computed in memory.
                for timeframe in (("W", "M") if prepared_market_context is None else ()):
                    derived_rows = [{
                        "symbol_id": symbol_row["id"], "timeframe": timeframe,
                        "period_start": bar["period_start"], "period_end": bar["period_end"],
                        "open": bar["open"], "high": bar["high"], "low": bar["low"],
                        "close": bar["close"], "volume": bar["volume"],
                        "is_complete": bar["is_complete"], "source_last_date": bar["source_last_date"],
                    } for bar in timeframe_rows[timeframe]]
                    counts["derived_bars"] += client.upsert(
                        "derived_bars", derived_rows, "symbol_id,timeframe,period_start"
                    )
                fibonacci_context = build_fibonacci_context(analysis_rows, confirmed_week_end, confirmed_month_end)
                benchmark_rows = {"D": benchmark_daily, "W": aggregate_bars(benchmark_daily, "W", confirmed_week_end), "M": aggregate_bars(benchmark_daily, "M", confirmed_month_end=confirmed_month_end)}
                decision_rows = {"D": analysis_rows, **{tf: [bar for bar in timeframe_rows[tf] if bar["is_complete"]] for tf in ("W", "M")}}
                decision_benchmark = {"D": benchmark_daily, **{tf: [bar for bar in benchmark_rows[tf] if bar["is_complete"]] for tf in ("W", "M")}}
                preliminary = {timeframe: analyze_bars(rows, fibonacci_context=fibonacci_context, timeframe=timeframe, include_classical=False) for timeframe, rows in decision_rows.items() if rows}
                results = {timeframe: analyze_bars(rows, weekly_patterns=preliminary.get("W", {}).get("patterns", []), monthly_snapshot=preliminary.get("M", {}).get("indicators", {}), benchmark_rows=decision_benchmark[timeframe], fibonacci_context=fibonacci_context, timeframe=timeframe) for timeframe, rows in decision_rows.items() if rows}
                context = {"weekly_patterns": results.get("W", {}).get("patterns", []), "weekly_classical_patterns": results.get("W", {}).get("classical_patterns", []), "weekly_snapshot": results.get("W", {}).get("indicators", {}), "monthly_snapshot": results.get("M", {}).get("indicators", {}), "candidate_sector": symbol_row["sector"]}
                for timeframe, rows in decision_rows.items():
                    if timeframe in results:
                        if "period_events" not in context:
                            context.update(_decision_context(analysis_rows, trading_date, {}, confirmed_week_end, confirmed_month_end, results.get("W")))
                        if timeframe in {"W", "M"} and not context["period_events"][timeframe]:
                            continue
                        timeframe_context = {**context, "wyckoff_context": classify_wyckoff_timeframe(timeframe, rows, period_event=context["period_events"].get(timeframe, False))}
                        if prepared_market_context is None:
                            _write_analysis(client, symbol_row["id"], timeframe, rows, decision_benchmark[timeframe], active_rules, counts, results[timeframe], timeframe_context, evaluate_signals=False)
                            pending_signals.append((symbol_row["id"], timeframe, rows, decision_benchmark[timeframe], results[timeframe], timeframe_context))
                        else:
                            timeframe_context["market_context"] = prepared_market_context
                            timeframe_context["portfolios"] = portfolios
                            _write_analysis(client, symbol_row["id"], timeframe, rows, decision_benchmark[timeframe], active_rules, counts, results[timeframe], timeframe_context, persist_evidence=False)
                counts["symbols"] += 1
                client.create_job_item({"job_run_id": job["id"], "symbol_id": symbol_row["id"], "item_key": symbol_row["symbol"], "status": "SUCCEEDED", "rows_written": 0, "duration_ms": int((monotonic() - started) * 1000)})
            except Exception as exc:
                counts["failed"] += 1; warnings.append(f"{symbol_row['symbol']}: {type(exc).__name__}")
                client.create_job_item({"job_run_id": job["id"], "symbol_id": symbol_row["id"], "item_key": symbol_row["symbol"], "status": "FAILED", "error_code": type(exc).__name__, "error_message": str(exc)[:500], "duration_ms": int((monotonic() - started) * 1000)})
        if prepared_market_context is None:
            vnindex_snapshot = _benchmark_snapshot(benchmark_daily, trading_date)
            breadth = _persist_universe_breadth(client, trading_date, vnindex_snapshot["trend_state"])
            counts["breadth_snapshots"] += 1
            market_context = _same_day_market_context(trading_date, breadth, vnindex_snapshot)
            past_session = any(row["trading_date"] > trading_date.isoformat() for row in benchmark_history)
            portfolios = _load_portfolios(client, active_rules, trading_date, historical=historical or past_session)
            for symbol_id, timeframe, rows, index_rows, result, context in pending_signals:
                context["market_context"] = market_context
                context["portfolios"] = portfolios
                _write_analysis(client, symbol_id, timeframe, rows, index_rows, active_rules, counts, result, context, persist_evidence=False)
        status = "SUCCEEDED" if not counts["failed"] else "PARTIAL"
        if status == "SUCCEEDED" and symbol_offset == 0 and symbol_limit is None and benchmark_daily and benchmark_daily[-1]["date"] == trading_date.isoformat():
            counts["published_signals"] = client.consolidated_signal_count(trading_date, ALGORITHM_VERSION)
        _persist_engine_stats(client, job["id"], trading_date, counts)
        client.finish_job(job["id"], {"status": status, "finished_at": _now(), "counts": counts, "warnings": warnings})
        return {"job_id": job["id"], "status": status, **counts}
    except Exception as exc:
        client.finish_job(job["id"], {"status": "FAILED", "finished_at": _now(), "counts": counts, "error_summary": str(exc)[:500]})
        raise
    finally:
        client.close()


def rebuild_market_health(start_date: date, end_date: date) -> dict[str, Any]:
    """Rebuild 2021+ point-in-time Market Health from stored price history only."""
    client = SupabaseRestClient(Settings.from_env())
    try:
        symbols = client.active_symbols()
        rows = client.all_daily_prices(start_date - timedelta(days=365), end_date)
        index = client.market_index("VNINDEX")
        index_rows = client.index_prices_in_range(index["id"], start_date - timedelta(days=100), end_date)
        snapshots = build_market_health_history(symbols, rows, start_date, end_date, index_rows=index_rows)
        published_dates = client.published_signal_dates(start_date, end_date)
        estimates = [item for item in snapshots if date.fromisoformat(item["trading_date"]) not in published_dates]
        # Sector JSON makes a 500-day payload too large for Supabase's REST
        # timeout. Smaller idempotent date batches can be retried safely.
        for offset in range(0, len(estimates), 50):
            batch = estimates[offset:offset + 50]
            for attempt in range(3):
                try:
                    client.upsert("market_breadth_snapshots", batch, "trading_date")
                    break
                except httpx.TimeoutException:
                    if attempt == 2:
                        raise
                    sleep(2 ** attempt)
        by_date = {date.fromisoformat(item["trading_date"]): item for item in snapshots}
        for published_day in sorted(published_dates & by_date.keys()):
            # Published sessions use the exact technical snapshots and
            # membership evaluated by Core Engine, never a price-only estimate.
            if not client.daily_snapshots_for_date(published_day):
                continue
            live_breadth = _persist_universe_breadth(client, published_day, by_date[published_day]["vnindex_trend_state"])
            by_date[published_day].update(live_breadth)
        latest = snapshots[-1] if snapshots else None
        return {
            "status": "SUCCEEDED", "start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "snapshots": len(snapshots),
            "latest": None if latest is None else {
                "trading_date": latest["trading_date"], "observed_count": latest["observed_count"],
                "eligible_count": latest["eligible_count"], "coverage_status": latest["coverage_status"],
                "sector_count": len(latest["sector_breadth"]),
                "sectors_with_flow": sum(row["flow_observed_count"] > 0 for row in latest["sector_breadth"]),
            },
        }
    finally:
        client.close()


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _rows_as_of(rows: list[dict[str, Any]], trading_date: date) -> list[dict[str, Any]]:
    """Keep only bars known at the requested EOD cutoff (ISO dates sort chronologically)."""
    cutoff = trading_date.isoformat()
    return [row for row in rows if row["trading_date"] <= cutoff]


def resolve_eod_session(client: SupabaseRestClient, requested: date) -> date:
    """Map weekends/recorded holidays backward, never to a future session."""
    candidate = requested if requested.weekday() < 5 else requested - timedelta(days=requested.weekday() - 4)
    closed = getattr(client, "closed_trading_sessions", None)
    if closed is None or candidate not in closed("HOSE", candidate, candidate):
        return candidate
    index = client.market_index("VNINDEX")
    sessions = client.index_price_dates(index["id"], candidate - timedelta(days=7), candidate - timedelta(days=1))
    if not sessions:
        raise RuntimeError(f"No verified VNINDEX session before closed date {candidate}")
    return date.fromisoformat(max(sessions))


def _confirmed_week_end(client: SupabaseRestClient, trading_date: date, benchmark_daily: list[dict]) -> date | None:
    if not benchmark_daily or benchmark_daily[-1]["date"] != trading_date.isoformat():
        return None
    if trading_date.weekday() == 4:
        return trading_date
    if trading_date.weekday() > 4:
        return None
    friday = trading_date + timedelta(days=4 - trading_date.weekday())
    closed = getattr(client, "closed_trading_sessions", None)
    if closed is None:
        return None
    required = {trading_date + timedelta(days=offset) for offset in range(1, 5 - trading_date.weekday())}
    return trading_date if required.issubset(closed("HOSE", trading_date + timedelta(days=1), friday)) else None


def _confirmed_month_end(client: SupabaseRestClient, trading_date: date, benchmark_daily: list[dict]) -> date | None:
    """The final verified session may precede calendar month-end or a holiday."""
    if not benchmark_daily or benchmark_daily[-1]["date"] != trading_date.isoformat():
        return None
    month_end = trading_date.replace(day=monthrange(trading_date.year, trading_date.month)[1])
    remaining = {trading_date + timedelta(days=offset) for offset in range(1, (month_end - trading_date).days + 1)
                 if (trading_date + timedelta(days=offset)).weekday() < 5}
    if not remaining:
        return trading_date
    closed = getattr(client, "closed_trading_sessions", None)
    return trading_date if closed and remaining.issubset(closed("HOSE", trading_date + timedelta(days=1), month_end)) else None


def _benchmark_snapshot(rows: list[dict], trading_date: date) -> dict:
    if not rows or (rows[-1].get("trading_date") or rows[-1].get("date")) != trading_date.isoformat():
        return {"trend_state": "UNKNOWN"}
    return calculate_indicators(rows).to_dict()


def _same_day_market_context(trading_date: date, breadth: dict, vnindex_snapshot: dict) -> dict:
    return {"trading_date": trading_date.isoformat(), "breadth": breadth, "vnindex_snapshot": vnindex_snapshot}


def _fetch_history_with_retry(provider: VnstockProvider, symbol: str, start: date, end: date) -> list:
    """Free upstream rate limits are transient; never burn the remaining universe."""
    for attempt in range(3):
        try:
            return provider.history(symbol, start, end)
        except Exception as exc:
            text = str(exc).lower()
            if attempt == 2 or not any(token in text for token in ("rate limit", "too many", "429", "giới hạn")):
                raise
            sleep(65 * (attempt + 1))
    raise RuntimeError("unreachable")


def _fetch_history_with_fallback(
    primary_provider: VnstockProvider,
    fallback_provider: VnstockProvider,
    symbol: str,
    start: date,
    end: date,
) -> tuple[list, bool]:
    """Try the alternate free source for one symbol without aborting the EOD run."""
    try:
        return _fetch_history_with_retry(primary_provider, symbol, start, end), False
    except Exception as primary_error:
        try:
            return _fetch_history_with_retry(fallback_provider, symbol, start, end), True
        except Exception as fallback_error:
            raise RuntimeError(
                f"both sources failed ({type(primary_error).__name__}, {type(fallback_error).__name__})"
            ) from fallback_error


def _stored_universe_breadth(client: SupabaseRestClient, trading_date: date) -> tuple[dict, list[dict]]:
    symbols = client.active_symbols()
    previous_date_getter = getattr(client, "latest_daily_snapshot_date_before", None)
    previous_date = previous_date_getter(trading_date) if previous_date_getter else None
    prior_rows = client.daily_snapshots_for_date(previous_date) if previous_date else []
    current_rows = client.daily_snapshots_for_date(trading_date)
    return build_breadth_membership(symbols, prior_rows, current_rows, trading_date.isoformat())


def _persist_universe_breadth(client: SupabaseRestClient, trading_date: date, vnindex_trend_state: str) -> dict:
    breadth, membership = _stored_universe_breadth(client, trading_date)
    client.upsert("breadth_universe_memberships", membership, "trading_date,symbol_id")
    client.upsert("market_breadth_snapshots", [{
        "trading_date": trading_date.isoformat(), **breadth,
        "vnindex_trend_state": vnindex_trend_state,
    }], "trading_date")
    return breadth


def _prior_market_context(client: SupabaseRestClient, trading_date: date) -> dict[str, dict] | None:
    getter = getattr(client, "market_breadth_snapshot", None)
    if getter is None:
        return None
    snapshot = getter(trading_date - timedelta(days=1))
    if not snapshot:
        return None
    if snapshot.get("trading_date") and (trading_date - date.fromisoformat(snapshot["trading_date"])).days > 7:
        return None
    breadth, membership = _stored_universe_breadth(client, date.fromisoformat(snapshot["trading_date"]))
    # Repair old batch-derived summaries from stored snapshots, never fetch prices.
    if any(snapshot.get(key) != value for key, value in breadth.items()):
        client.upsert("market_breadth_snapshots", [{"trading_date": snapshot["trading_date"], **breadth, "vnindex_trend_state": snapshot.get("vnindex_trend_state", "UNKNOWN")}], "trading_date")
    client.upsert("breadth_universe_memberships", membership, "trading_date,symbol_id")
    return {
        "breadth": breadth,
        "vnindex_snapshot": {"trend_state": snapshot.get("vnindex_trend_state", "UNKNOWN")},
    }


def _write_analysis(
    client: SupabaseRestClient,
    symbol_id: int,
    timeframe: str,
    rows: list[dict],
    benchmark_rows: list[dict],
    active_rules: list[dict],
    counts: dict[str, int], result: dict, context: dict[str, Any], *, persist_evidence: bool = True, evaluate_signals: bool = True,
) -> None:
    if not rows:
        return
    if persist_evidence:
        snapshot = {
            "symbol_id": symbol_id, "timeframe": timeframe,
            "as_of_date": result["as_of_date"], "input_last_date": result["as_of_date"],
            "algorithm_version": ALGORITHM_VERSION, "classical_candidates": result.get("classical_patterns", []), **result["indicators"],
        }
        counts["snapshots"] += client.upsert(
            "technical_snapshots", [snapshot], "symbol_id,timeframe,as_of_date"
        )
        patterns = [{
            "symbol_id": symbol_id, "timeframe": timeframe,
            "pattern_type": pattern["pattern_type"], "state": pattern["state"],
            "start_date": rows[pattern["start_index"]]["date"],
            "end_date": rows[pattern["end_index"]]["date"],
            "as_of_date": result["as_of_date"], "trigger_price": pattern["trigger_price"],
            "confirmed_at": pattern.get("confirmed_at"),
            "invalidation_price": pattern["invalidation_price"],
            "quality_score": pattern["quality_score"], "direction": pattern["direction"],
            "evidence": pattern["evidence"], "reasons": pattern["reasons"],
            "algorithm_version": ALGORITHM_VERSION,
        } for pattern in result["patterns"]]
        replacer = getattr(client, "replace_pattern_snapshot", None)
        if replacer is not None:
            counts["patterns"] += replacer(symbol_id, timeframe, result["as_of_date"], patterns)
        else:
            counts["patterns"] += client.upsert(
                "pattern_instances", patterns,
                "symbol_id,timeframe,pattern_type,start_date,as_of_date,algorithm_version",
            )
        zones = [{
            "symbol_id": symbol_id, "timeframe": timeframe,
            "zone_type": zone["zone_type"], "start_date": rows[zone["start_index"]]["date"],
            "as_of_date": result["as_of_date"], "lower_price": zone["lower_price"],
            "upper_price": zone["upper_price"], "touches": zone["touches"],
            "active": True, "strength": zone["strength"], "evidence": zone["evidence"],
            "algorithm_version": ALGORITHM_VERSION,
        } for zone in result["zones"]]
        replacer = getattr(client, "replace_zone_snapshot", None)
        if replacer is not None:
            counts["zones"] += replacer(symbol_id, timeframe, result["as_of_date"], zones)
        else:
            counts["zones"] += client.upsert(
                "support_resistance_zones", zones,
                "symbol_id,timeframe,as_of_date,zone_type,lower_price,upper_price",
            )
    if not evaluate_signals:
        return
    if timeframe in {"W", "M"} and not context.get("period_events", {}).get(timeframe):
        client.delete_consolidated_signal(symbol_id, timeframe, context.get("evaluation_date", result["as_of_date"]))
        return
    signal_rows = []
    raw_evaluations = []
    evaluations = []
    for version in active_rules:
        dsl = version["dsl"]
        if timeframe not in dsl.get("timeframes", [dsl.get("timeframe", "D")]):
            continue
        rule = version.get("rules") or {}
        owner = (context.get("portfolios") or {}).get(rule.get("user_id"), {})
        positions = owner.get("positions", [])
        held = [p for p in positions if p["symbol_id"] == symbol_id]
        position = None
        if held:
            stops = [float(p["stop_price"]) / STOCK_PRICE_TO_VND for p in held if p.get("stop_price")]
            position = {"invalidation_price": max(stops) if stops else None, "entry_date": max(p["opened_at"] for p in held)}
        stats = counts.get("engine_stats", {}).get(_stats_key(version["id"], timeframe))
        if stats is not None:
            stats["evaluated_count"] += 1
        engine_context = {
            "dsl": dsl,
            "timeframe": timeframe,
            "bars": rows,
            "patterns": result["patterns"],
            "classical_patterns": result.get("classical_patterns", []),
            "snapshot": result["indicators"],
            "zones": result["zones"],
            "fibonacci_context": result.get("fibonacci_context", {}),
            "position": position or context.get("position"),
            "market_context": context.get("market_context"),
            "wyckoff_context": context.get("wyckoff_context"),
            "multi_timeframe_context": {
                "weekly_patterns": context.get("weekly_patterns", []),
                "weekly_snapshot": context.get("weekly_snapshot", {}),
                "monthly_snapshot": context.get("monthly_snapshot", {}),
            },
            "portfolio_positions": owner.get("valued_positions", context.get("portfolio_positions")),
            "candidate_sector": context.get("candidate_sector"),
            "capital": owner.get("capital", context.get("capital")),
            "risk_pct": owner.get("risk_pct", 1),
            "portfolio_error": owner.get("error"),
            "daily_snapshot": context.get("daily_snapshot", result["indicators"]),
            "data_date": context.get("data_date", result["as_of_date"]),
            "evaluation_date": context.get("evaluation_date", result["as_of_date"]),
            "period_event": context.get("period_events", {}).get(timeframe, False),
            "rule_context": context,
        }
        if timeframe in {"W", "M"} and dsl.get("engine") == "core_ladder_v2":
            passed, action, reasons = evaluate_period_signal(timeframe, engine_context)
        else:
            # Portfolio sizing is applied once, in VND, by the shared policy below.
            proposal_context = {**engine_context, "portfolio_positions": None}
            passed, action, reasons = evaluate_named_engine(dsl.get("engine"), dsl.get("overrides"), proposal_context)
            engine_context["engine_evidence"] = proposal_context.get("engine_evidence", {})
        proposed_action = action
        if passed:
            action, reasons = reconcile_proposal(
                action, reasons, timeframe=timeframe, patterns=[*result["patterns"], *result.get("classical_patterns", [])],
                weekly_patterns=[*context.get("weekly_patterns", []), *context.get("weekly_classical_patterns", [])],
            )
            if timeframe == "D" and action in {"PROBE_BUY", "ADD"} and result["indicators"].get("flow_state") == "BLUE":
                reasons = list(dict.fromkeys([*reasons, "FLOW_BAR_SELLING_PRESSURE"]))
            if timeframe in {"W", "M"} and action in {"PROBE_BUY", "ADD"}:
                action = "WATCH"
                reasons = list(dict.fromkeys([*reasons, "DAILY_TRIGGER_REQUIRED"]))
                engine_context.setdefault("engine_evidence", {})["context_only"] = True
        evidence = engine_context.setdefault("engine_evidence", {})
        matched = [p for p in result["patterns"] if p.get("state") == "CONFIRMED" and any(p.get("pattern_type", "?") in reason for reason in reasons)]
        if matched and not evidence.get("invalidation_price"):
            top = max(matched, key=lambda p: p.get("quality_score", 0))
            evidence.update({key: top.get(key) for key in ("pattern_type", "quality_score", "invalidation_price", "trigger_price")})
        if passed or (timeframe == "D" and engine_context.get("position")):
            action, reasons = apply_signal_policy(action, reasons, engine_context)
            passed = passed or action == "EXIT"
            if engine_context["data_date"] != engine_context["evaluation_date"]:
                # Keep the failed evaluation for audit, never publish a WATCH
                # based on an older close as if it were today's signal.
                passed = False
            elif passed and timeframe == "D" and action in {"PROBE_BUY", "ADD"}:
                reasons = list(dict.fromkeys([*reasons, *relative_strength_context_reasons(engine_context)]))
        evaluation_date = context.get("evaluation_date", result["as_of_date"])
        if passed or reasons: evaluations.append({"rule_version_id": version["id"], "symbol_id": symbol_id, "timeframe": timeframe, "as_of_date": evaluation_date, "proposed_action": proposed_action, "action": action, "emitted": passed, "reasons": reasons or ["NO_MATCHING_SETUP"], "evidence": engine_context.get("engine_evidence") or {}})
        if passed:
            if stats is not None:
                stats["emitted_count"] += 1
            raw_signal = {
                "rule_version_id": version["id"], "symbol_id": symbol_id,
                "timeframe": timeframe, "as_of_date": evaluation_date,
                "action": action, "source": "CORE_PACK" if rule.get("kind") == "CORE_PACK" else "USER_RULE", "score": 100,
                "reasons": reasons,
                "evidence": {
                    "algorithm_version": ALGORITHM_VERSION,
                    **{key: value for key, value in result["indicators"].items() if value is not None},
                    **(engine_context.get("engine_evidence") or {}),
                    **({"evidence_cluster": _pattern_evidence_cluster(reasons)} if _pattern_evidence_cluster(reasons) else {}),
                },
            }
            signal_rows.append(raw_signal)
            raw_evaluations.append({**raw_signal, "engine": rule.get("name") or dsl.get("engine") or "Rule Studio"})
    counts["signals"] += client.upsert(
        "signals", signal_rows, "rule_version_id,symbol_id,timeframe,as_of_date,action"
    )
    if evaluations:
        client.upsert("signal_evaluations", evaluations, "rule_version_id,symbol_id,timeframe,as_of_date")
    if raw_evaluations:
        consolidated = resolve_consolidated_signal(raw_evaluations)
        winners = {item["rule_version_id"] for item in raw_evaluations if item["action"] == consolidated["composite_action"] and not (item.get("evidence") or {}).get("context_only")}
        for version_id in winners:
            stats = counts.get("engine_stats", {}).get(_stats_key(version_id, timeframe))
            if stats is not None:
                stats["contributed_count"] += 1
        counts.setdefault("consolidated_signals", 0)
        counts["consolidated_signals"] += client.upsert("consolidated_signals", [{
            "symbol_id": symbol_id, "timeframe": timeframe, "as_of_date": context.get("evaluation_date", result["as_of_date"]),
            "source_revision": ALGORITHM_VERSION,
            **{key: consolidated[key] for key in ("composite_action", "confluence_score", "confluence_count", "consensus_engines", "reasons", "signal_state")},
        }], "symbol_id,timeframe,as_of_date")
    else:
        client.delete_consolidated_signal(symbol_id, timeframe, context.get("evaluation_date", result["as_of_date"]))


def _load_portfolios(client, active_rules: list[dict], trading_date: date, *, historical: bool = False) -> dict:
    getter = getattr(client, "portfolio_context", None)
    if getter is None:
        return {}
    owners = {version.get("rules", {}).get("user_id") for version in active_rules} - {None}
    result = {}
    for owner in owners:
        try:
            item = getter(owner)
            if historical or any(str(position.get("opened_at") or "")[:10] > trading_date.isoformat() for position in item["positions"]):
                if float(item.get("capital") or 0) > 0 or item["positions"]:
                    item["error"] = "HISTORICAL_PORTFOLIO_UNAVAILABLE"
                item["positions"] = []
                item["valued_positions"] = []
                result[owner] = item
                continue
            item["valued_positions"] = []
            for position in item["positions"]:
                rows = _rows_as_of(client.price_history(position["symbol_id"], MULTI_TIMEFRAME_HISTORY_LIMIT), trading_date)
                if not rows or (trading_date - date.fromisoformat(rows[-1]["trading_date"])).days > 7:
                    item["error"] = "POSITION_PRICE_UNAVAILABLE"
                price = float(rows[-1]["close"]) * STOCK_PRICE_TO_VND if rows else float(position["average_cost"])
                item["valued_positions"].append({"market_price": price, "quantity": position["quantity"], "sector": (position.get("symbols") or {}).get("sector", "UNKNOWN")})
            result[owner] = item
        except Exception:
            result[owner] = {"error": "PORTFOLIO_CONTEXT_UNAVAILABLE"}
    return result


def _decision_context(daily: list[dict], trading_date: date, portfolios: dict, confirmed_week_end: date | None = None, confirmed_month_end: date | None = None, weekly_analysis: dict | None = None) -> dict:
    completed = {tf: [b for b in aggregate_bars(daily, tf, confirmed_week_end, confirmed_month_end) if b["is_complete"]] for tf in ("W", "M")}
    weekly = weekly_analysis if weekly_analysis is not None else analyze_bars(completed["W"], timeframe="W") if completed["W"] else {}
    events = {}
    for tf in ("W", "M"):
        confirmed_end = confirmed_week_end if tf == "W" else confirmed_month_end
        events[tf] = bool(confirmed_end == trading_date and daily[-1]["date"] == trading_date.isoformat()
                          and completed[tf] and completed[tf][-1]["source_last_date"] == trading_date.isoformat())
    return {"portfolios": portfolios, "evaluation_date": trading_date.isoformat(), "data_date": daily[-1]["date"], "daily_snapshot": calculate_indicators(daily).to_dict(), "weekly_snapshot": weekly.get("indicators", {}), "weekly_patterns": weekly.get("patterns", []), "weekly_classical_patterns": weekly.get("classical_patterns", []), "monthly_snapshot": monthly_trend(completed["M"]), "period_events": events}


def _pattern_evidence_cluster(reasons: list[str]) -> str | None:
    """Group engines that merely restate the same confirmed chart pattern."""
    for reason in reasons:
        for prefix in ("V0_", "PATTERN_", "CORE_V1_"):
            if reason.startswith(prefix):
                token = reason[len(prefix):]
                for suffix in ("_CONFIRMED", "_READY"):
                    if token.endswith(suffix):
                        name = token[:-len(suffix)]
                        return {"FLAT_BASE": "ACCUMULATION_BASE", "FLAT_BASE_BREAKOUT": "ACCUMULATION_BASE", "FLAG_PENNANT": "BULL_FLAG"}.get(name, name)
    return None

def _stats_key(version_id: str, timeframe: str) -> str:
    return version_id if timeframe == "D" else f"{version_id}:{timeframe}"


def _initialize_engine_stats(active_rules: list[dict]) -> dict[str, dict[str, Any]]:
    return {
        _stats_key(version["id"], timeframe): {
            "rule_id": version["rules"]["id"], "rule_version_id": version["id"],
            "engine_name": version["rules"].get("name") or version["dsl"].get("engine") or "Rule Studio",
            "timeframe": timeframe,
            "evaluated_count": 0, "emitted_count": 0, "contributed_count": 0,
        }
        for version in active_rules
        for timeframe in version["dsl"].get("timeframes", [version["dsl"].get("timeframe", "D")])
    }


def _persist_engine_stats(client: SupabaseRestClient, job_id: str, trading_date: date, counts: dict[str, Any]) -> None:
    stats = counts.get("engine_stats", {})
    rows = [{"job_run_id": job_id, "trading_date": trading_date.isoformat(), **value} for value in stats.values()]
    if rows:
        client.upsert("engine_run_summaries", rows, "job_run_id,rule_version_id,timeframe")
