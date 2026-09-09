from __future__ import annotations

from datetime import date, timedelta
from time import monotonic, sleep
from typing import Any

from .analysis import ALGORITHM_VERSION, analyze_bars
from .config import Settings
from .indicators import relative_strength
from .provider_vnstock import VnstockProvider
from .rules import evaluate_rule
from .supabase_rest import SupabaseRestClient
from .timeframes import aggregate_bars
from .zones import detect_zones


def run_eod(
    trading_date: date,
    *,
    source: str = "KBS",
    lookback_days: int = 10,
    symbol_offset: int = 0,
    symbol_limit: int | None = None,
    pause_seconds: float = 0.25,
) -> dict[str, Any]:
    client = SupabaseRestClient(Settings.from_env())
    provider = VnstockProvider(source)
    job = client.create_job({
        "job_type": "EOD_INGEST", "trading_date": trading_date.isoformat(),
        "status": "RUNNING", "trigger_type": "SCHEDULED",
        "source_revision": ALGORITHM_VERSION,
    })
    counts = {"symbols": 0, "prices": 0, "derived_bars": 0, "snapshots": 0, "patterns": 0, "zones": 0, "signals": 0, "failed": 0}
    warnings: list[str] = []
    try:
        symbols = client.active_symbols()
        active_rules = client.active_rule_versions()
        benchmark_daily: list[dict] = []
        try:
            index = client.market_index("VNINDEX")
            index_bars = provider.history("VNINDEX", trading_date - timedelta(days=lookback_days), trading_date)
            index_rows = [{
                "index_id": index["id"], "trading_date": bar.trading_date.isoformat(),
                "open": float(bar.open), "high": float(bar.high), "low": float(bar.low),
                "close": float(bar.close), "volume": bar.volume, "source": bar.source,
                "collected_at": bar.collected_at.isoformat(),
            } for bar in index_bars]
            client.upsert("market_index_prices", index_rows, "index_id,trading_date")
            benchmark_daily = [{**row, "date": row["trading_date"]} for row in client.index_price_history(index["id"])]
        except Exception as exc:
            warnings.append(f"VNINDEX: {type(exc).__name__}")
        symbols = symbols[symbol_offset:]
        if symbol_limit:
            symbols = symbols[:symbol_limit]
        for symbol_row in symbols:
            started = monotonic()
            try:
                fetched = provider.history(
                    symbol_row["symbol"], trading_date - timedelta(days=lookback_days), trading_date
                )
                price_rows = [{
                    "symbol_id": symbol_row["id"], "trading_date": bar.trading_date.isoformat(),
                    "open": float(bar.open), "high": float(bar.high), "low": float(bar.low),
                    "close": float(bar.close), "volume": bar.volume, "source": bar.source,
                    "collected_at": bar.collected_at.isoformat(), "quality_status": "VALID",
                } for bar in fetched]
                counts["prices"] += client.upsert("daily_prices", price_rows, "symbol_id,trading_date")
                history = client.price_history(symbol_row["id"])
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
                    for timeframe, scoped_rows in timeframe_rows.items():
                        _write_analysis(client, symbol_row["id"], timeframe, scoped_rows, benchmark_rows[timeframe], active_rules, counts)
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
        status = "SUCCEEDED" if counts["failed"] == 0 else "PARTIAL"
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


def _write_analysis(
    client: SupabaseRestClient,
    symbol_id: int,
    timeframe: str,
    rows: list[dict],
    benchmark_rows: list[dict],
    active_rules: list[dict],
    counts: dict[str, int],
) -> None:
    if not rows:
        return
    result = analyze_bars(rows)
    benchmark_by_date = {item["date"]: float(item["close"]) for item in benchmark_rows}
    aligned = [(float(item["close"]), benchmark_by_date[item["date"]]) for item in rows if item["date"] in benchmark_by_date]
    result["indicators"]["relative_strength_market"] = relative_strength(
        [item[0] for item in aligned], [item[1] for item in aligned]
    ) if aligned else None
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
    } for zone in detect_zones(rows)]
    counts["zones"] += client.upsert(
        "support_resistance_zones", zones,
        "symbol_id,timeframe,as_of_date,zone_type,lower_price,upper_price",
    )
    signal_rows = []
    for version in active_rules:
        dsl = version["dsl"]
        if dsl.get("timeframe", "D") != timeframe:
            continue
        passed, reasons = evaluate_rule(dsl, result["indicators"], rows)
        if passed:
            signal_rows.append({
                "rule_version_id": version["id"], "symbol_id": symbol_id,
                "timeframe": timeframe, "as_of_date": result["as_of_date"],
                "action": dsl.get("action", "WATCH"), "score": 100,
                "reasons": reasons,
                "evidence": {key: value for key, value in result["indicators"].items() if value is not None},
            })
    counts["signals"] += client.upsert(
        "signals", signal_rows, "rule_version_id,symbol_id,timeframe,as_of_date,action"
    )
