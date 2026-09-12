from __future__ import annotations

from datetime import date, timedelta
from time import monotonic, sleep
from typing import Any

from .analysis import ALGORITHM_VERSION, analyze_bars
from .config import Settings
from .engines import evaluate_named_engine
from .indicators import calculate_indicators
from .market_regime import compute_breadth
from .provider_vnstock import VnstockProvider
from .resolution import resolve_consolidated_signal
from .supabase_rest import SupabaseRestClient
from .timeframes import aggregate_bars

# VNINDEX's first session was 28/07/2000. This keeps its benchmark history full
# through the app's operational planning horizon without expanding symbol fetches.
VNINDEX_HISTORY_START = date(2000, 7, 28)
BENCHMARK_LOOKBACK_DAYS = (date(2050, 1, 1) - VNINDEX_HISTORY_START).days
# Daily Fast Lane reuses the locally stored 260-session benchmark window. It only
# asks the upstream source for a small overlap to capture the newly closed session.
FAST_LANE_BENCHMARK_FETCH_DAYS = 14


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
) -> dict[str, Any]:
    client = SupabaseRestClient(Settings.from_env())
    provider = VnstockProvider(source)
    fallback_source = "VCI" if source.upper() == "KBS" else "KBS"
    fallback_provider = VnstockProvider(fallback_source)
    job = client.create_job({
        "job_type": "EOD_INGEST", "trading_date": trading_date.isoformat(),
        "status": "RUNNING", "trigger_type": "SCHEDULED",
        "source_revision": ALGORITHM_VERSION,
    })
    counts = {"symbols": 0, "prices": 0, "derived_bars": 0, "snapshots": 0, "patterns": 0, "zones": 0, "signals": 0, "consolidated_signals": 0, "breadth_snapshots": 0, "failed": 0}
    warnings: list[str] = []
    try:
        symbols = client.active_symbols()
        active_rules = client.active_rule_versions()
        counts["engine_stats"] = _initialize_engine_stats(active_rules)
        market_context = _prior_market_context(client, trading_date)
        daily_snapshots: list[dict] = []
        benchmark_daily: list[dict] = []
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
            benchmark_daily = [
                {**row, "date": row["trading_date"]}
                for row in _rows_as_of(client.index_price_history(index["id"]), trading_date)
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
                benchmark_daily = [{**row, "date": row["trading_date"]} for row in _rows_as_of(client.index_price_history(index["id"]), trading_date)]
        except Exception as exc:
            warnings.append(f"VNINDEX: {type(exc).__name__}")
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
                history = _rows_as_of(client.price_history(symbol_row["id"]), trading_date)
                analysis_rows = [{**row, "date": row["trading_date"]} for row in history]
                if analysis_rows:
                    timeframe_rows = {"D": analysis_rows}
                    benchmark_rows = {"D": benchmark_daily}
                    for timeframe in ("W", "M"):
                        aggregated = aggregate_bars(analysis_rows, timeframe)
                        timeframe_rows[timeframe] = aggregated
                        benchmark_rows[timeframe] = aggregate_bars(benchmark_daily, timeframe)
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
                    preliminary = {timeframe: analyze_bars(scoped_rows) for timeframe, scoped_rows in timeframe_rows.items() if scoped_rows}
                    results = {timeframe: analyze_bars(scoped_rows, weekly_patterns=preliminary.get("W", {}).get("patterns", []), monthly_snapshot=preliminary.get("M", {}).get("indicators", {}), benchmark_rows=benchmark_rows[timeframe], market_context=market_context if timeframe == "D" else None) for timeframe, scoped_rows in timeframe_rows.items() if scoped_rows}
                    context = {
                        "weekly_patterns": results.get("W", {}).get("patterns", []),
                        "weekly_snapshot": results.get("W", {}).get("indicators", {}),
                        "monthly_snapshot": results.get("M", {}).get("indicators", {}),
                        "market_context": market_context,
                        "candidate_sector": symbol_row["sector"],
                    }
                    for timeframe, scoped_rows in timeframe_rows.items():
                        if timeframe in results:
                            _write_analysis(client, symbol_row["id"], timeframe, scoped_rows, benchmark_rows[timeframe], active_rules, counts, results[timeframe], context)
                    if "D" in results:
                        daily_snapshots.append(results["D"]["indicators"])
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
        if daily_snapshots and write_breadth_snapshot:
            breadth = compute_breadth(daily_snapshots)
            vnindex_snapshot = calculate_indicators(benchmark_daily).to_dict() if benchmark_daily else {"trend_state": "UNKNOWN"}
            counts["breadth_snapshots"] += client.upsert("market_breadth_snapshots", [{
                "trading_date": trading_date.isoformat(), **breadth,
                "vnindex_trend_state": vnindex_snapshot["trend_state"],
            }], "trading_date")
        status = "SUCCEEDED" if counts["failed"] == 0 else "PARTIAL"
        _persist_engine_stats(client, job["id"], trading_date, counts)
        client.finish_job(job["id"], {"status": status, "finished_at": _now(), "counts": counts, "warnings": warnings})
        return {"job_id": job["id"], "status": status, **counts}
    except Exception as exc:
        client.finish_job(job["id"], {"status": "FAILED", "finished_at": _now(), "counts": counts, "error_summary": str(exc)[:500]})
        raise
    finally:
        client.close()


def finalize_fast_lane(trading_date: date) -> dict[str, Any]:
    """Gate final alerts on complete two-worker coverage, then publish D breadth."""
    client = SupabaseRestClient(Settings.from_env())
    try:
        expected = {row["id"] for row in client.active_symbols()}
        snapshots = client.daily_snapshots_for_date(trading_date)
        covered = {row["symbol_id"] for row in snapshots}
        missing = expected - covered
        if missing:
            raise RuntimeError(f"Fast Lane incomplete: {len(covered)}/{len(expected)} daily snapshots")
        index = client.market_index("VNINDEX")
        benchmark = _rows_as_of(client.index_price_history(index["id"]), trading_date)
        vnindex_snapshot = calculate_indicators(benchmark).to_dict() if benchmark else {"trend_state": "UNKNOWN"}
        breadth = compute_breadth(snapshots)
        client.upsert("market_breadth_snapshots", [{
            "trading_date": trading_date.isoformat(), **breadth,
            "vnindex_trend_state": vnindex_snapshot["trend_state"],
        }], "trading_date")
        return {"status": "SUCCEEDED", "covered": len(covered), "expected": len(expected), "breadth": breadth}
    finally:
        client.close()


def rebuild_signals(trading_date: date, *, symbol_offset: int = 0, symbol_limit: int | None = None) -> dict[str, Any]:
    """Re-evaluate stored EOD data only; this never calls an upstream price source."""
    client = SupabaseRestClient(Settings.from_env())
    job = client.create_job({"job_type": "DERIVE_BARS", "trading_date": trading_date.isoformat(), "status": "RUNNING", "trigger_type": "MANUAL", "source_revision": ALGORITHM_VERSION})
    counts = {"symbols": 0, "snapshots": 0, "patterns": 0, "zones": 0, "signals": 0, "consolidated_signals": 0, "failed": 0}
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
        market_context = _prior_market_context(client, trading_date)
        index = client.market_index("VNINDEX")
        benchmark_daily = [{**row, "date": row["trading_date"]} for row in _rows_as_of(client.index_price_history(index["id"]), trading_date)]
        for symbol_row in symbols:
            started = monotonic()
            try:
                analysis_rows = [{**row, "date": row["trading_date"]} for row in _rows_as_of(client.price_history(symbol_row["id"]), trading_date)]
                if not analysis_rows:
                    raise ValueError("no stored price history")
                timeframe_rows = {"D": analysis_rows, "W": aggregate_bars(analysis_rows, "W"), "M": aggregate_bars(analysis_rows, "M")}
                benchmark_rows = {"D": benchmark_daily, "W": aggregate_bars(benchmark_daily, "W"), "M": aggregate_bars(benchmark_daily, "M")}
                preliminary = {timeframe: analyze_bars(rows) for timeframe, rows in timeframe_rows.items() if rows}
                results = {timeframe: analyze_bars(rows, weekly_patterns=preliminary.get("W", {}).get("patterns", []), monthly_snapshot=preliminary.get("M", {}).get("indicators", {}), benchmark_rows=benchmark_rows[timeframe], market_context=market_context if timeframe == "D" else None) for timeframe, rows in timeframe_rows.items() if rows}
                context = {"weekly_patterns": results.get("W", {}).get("patterns", []), "weekly_snapshot": results.get("W", {}).get("indicators", {}), "monthly_snapshot": results.get("M", {}).get("indicators", {}), "market_context": market_context, "candidate_sector": symbol_row["sector"]}
                for timeframe, rows in timeframe_rows.items():
                    if timeframe in results:
                        _write_analysis(client, symbol_row["id"], timeframe, rows, benchmark_rows[timeframe], active_rules, counts, results[timeframe], context, persist_evidence=False)
                counts["symbols"] += 1
                client.create_job_item({"job_run_id": job["id"], "symbol_id": symbol_row["id"], "item_key": symbol_row["symbol"], "status": "SUCCEEDED", "rows_written": 0, "duration_ms": int((monotonic() - started) * 1000)})
            except Exception as exc:
                counts["failed"] += 1; warnings.append(f"{symbol_row['symbol']}: {type(exc).__name__}")
                client.create_job_item({"job_run_id": job["id"], "symbol_id": symbol_row["id"], "item_key": symbol_row["symbol"], "status": "FAILED", "error_code": type(exc).__name__, "error_message": str(exc)[:500], "duration_ms": int((monotonic() - started) * 1000)})
        status = "SUCCEEDED" if not counts["failed"] else "PARTIAL"
        _persist_engine_stats(client, job["id"], trading_date, counts)
        client.finish_job(job["id"], {"status": status, "finished_at": _now(), "counts": counts, "warnings": warnings})
        return {"job_id": job["id"], "status": status, **counts}
    except Exception as exc:
        client.finish_job(job["id"], {"status": "FAILED", "finished_at": _now(), "counts": counts, "error_summary": str(exc)[:500]})
        raise
    finally:
        client.close()


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _rows_as_of(rows: list[dict[str, Any]], trading_date: date) -> list[dict[str, Any]]:
    """Keep only bars known at the requested EOD cutoff (ISO dates sort chronologically)."""
    cutoff = trading_date.isoformat()
    return [row for row in rows if row["trading_date"] <= cutoff]


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


def _prior_market_context(client: SupabaseRestClient, trading_date: date) -> dict[str, dict] | None:
    getter = getattr(client, "market_breadth_snapshot", None)
    if getter is None:
        return None
    snapshot = getter(trading_date - timedelta(days=1))
    if not snapshot:
        return None
    return {
        "breadth": {"pct_above_sma50": snapshot.get("pct_above_sma50"), "sample_size": snapshot.get("sample_size")},
        "vnindex_snapshot": {"trend_state": snapshot.get("vnindex_trend_state", "UNKNOWN")},
    }


def _write_analysis(
    client: SupabaseRestClient,
    symbol_id: int,
    timeframe: str,
    rows: list[dict],
    benchmark_rows: list[dict],
    active_rules: list[dict],
    counts: dict[str, int], result: dict, context: dict[str, Any], *, persist_evidence: bool = True,
) -> None:
    if not rows:
        return
    if persist_evidence:
        snapshot = {
            "symbol_id": symbol_id, "timeframe": timeframe,
            "as_of_date": result["as_of_date"], "input_last_date": result["as_of_date"],
            "algorithm_version": ALGORITHM_VERSION, **result["indicators"],
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
            "invalidation_price": pattern["invalidation_price"],
            "quality_score": pattern["quality_score"], "direction": pattern["direction"],
            "evidence": pattern["evidence"], "reasons": pattern["reasons"],
            "algorithm_version": ALGORITHM_VERSION,
        } for pattern in result["patterns"]]
        counts["patterns"] += client.upsert(
            "pattern_instances", patterns,
            "symbol_id,timeframe,pattern_type,start_date,as_of_date,algorithm_version",
        )
        zones = [{
            "symbol_id": symbol_id, "timeframe": timeframe,
            "zone_type": zone["zone_type"], "start_date": rows[zone["start_index"]]["date"],
            "as_of_date": result["as_of_date"], "lower_price": zone["lower_price"],
            "upper_price": zone["upper_price"], "touches": zone["touches"],
            "strength": zone["strength"], "evidence": zone["evidence"],
            "algorithm_version": ALGORITHM_VERSION,
        } for zone in result["zones"]]
        counts["zones"] += client.upsert(
            "support_resistance_zones", zones,
            "symbol_id,timeframe,as_of_date,zone_type,lower_price,upper_price",
        )
    signal_rows = []
    raw_evaluations = []
    for version in active_rules:
        dsl = version["dsl"]
        if dsl.get("timeframe", "D") != timeframe:
            continue
        rule = version.get("rules") or {}
        stats = counts.get("engine_stats", {}).get(version["id"])
        if stats is not None:
            stats["evaluated_count"] += 1
        engine_context = {
            "dsl": dsl,
            "bars": rows,
            "patterns": result["patterns"],
            "snapshot": result["indicators"],
            "zones": result["zones"],
            "position": context.get("position"),
            "market_context": context.get("market_context") if timeframe == "D" else None,
            "multi_timeframe_context": {
                "weekly_patterns": context.get("weekly_patterns", []),
                "weekly_snapshot": context.get("weekly_snapshot", {}),
                "monthly_snapshot": context.get("monthly_snapshot", {}),
            },
            "portfolio_positions": context.get("portfolio_positions"),
            "candidate_sector": context.get("candidate_sector"),
            "capital": context.get("capital"),
            "rule_context": context,
        }
        passed, action, reasons = evaluate_named_engine(dsl.get("engine"), dsl.get("overrides"), engine_context)
        if passed:
            if stats is not None:
                stats["emitted_count"] += 1
            raw_signal = {
                "rule_version_id": version["id"], "symbol_id": symbol_id,
                "timeframe": timeframe, "as_of_date": result["as_of_date"],
                "action": action, "source": "CORE_PACK" if rule.get("kind") == "CORE_PACK" else "USER_RULE", "score": 100,
                "reasons": reasons,
                "evidence": {
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
    if raw_evaluations:
        consolidated = resolve_consolidated_signal(raw_evaluations)
        winners = {item["rule_version_id"] for item in raw_evaluations if item["action"] == consolidated["composite_action"]}
        for version_id in winners:
            stats = counts.get("engine_stats", {}).get(version_id)
            if stats is not None:
                stats["contributed_count"] += 1
        counts.setdefault("consolidated_signals", 0)
        counts["consolidated_signals"] += client.upsert("consolidated_signals", [{
            "symbol_id": symbol_id, "timeframe": timeframe, "as_of_date": result["as_of_date"],
            **{key: consolidated[key] for key in ("composite_action", "confluence_score", "confluence_count", "consensus_engines", "reasons")},
        }], "symbol_id,timeframe,as_of_date")
    else:
        client.delete_consolidated_signal(symbol_id, timeframe, result["as_of_date"])


def _pattern_evidence_cluster(reasons: list[str]) -> str | None:
    """Group engines that merely restate the same confirmed chart pattern."""
    for reason in reasons:
        for prefix in ("V0_", "PATTERN_", "CORE_V1_"):
            if reason.startswith(prefix):
                token = reason[len(prefix):]
                for suffix in ("_CONFIRMED", "_READY"):
                    if token.endswith(suffix):
                        return token[:-len(suffix)]
    return None

def _initialize_engine_stats(active_rules: list[dict]) -> dict[str, dict[str, Any]]:
    return {
        version["id"]: {
            "rule_id": version["rules"]["id"], "rule_version_id": version["id"],
            "engine_name": version["rules"].get("name") or version["dsl"].get("engine") or "Rule Studio",
            "timeframe": version["dsl"].get("timeframe", "D"),
            "evaluated_count": 0, "emitted_count": 0, "contributed_count": 0,
        }
        for version in active_rules
    }


def _persist_engine_stats(client: SupabaseRestClient, job_id: str, trading_date: date, counts: dict[str, Any]) -> None:
    stats = counts.get("engine_stats", {})
    rows = [{"job_run_id": job_id, "trading_date": trading_date.isoformat(), **value} for value in stats.values()]
    if rows:
        client.upsert("engine_run_summaries", rows, "job_run_id,rule_version_id,timeframe")
