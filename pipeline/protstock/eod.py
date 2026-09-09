from __future__ import annotations

from datetime import date, timedelta
from time import monotonic, sleep
from typing import Any

from .analysis import ALGORITHM_VERSION, analyze_bars
from .config import Settings
from .provider_vnstock import VnstockProvider
from .supabase_rest import SupabaseRestClient


def run_eod(
    trading_date: date,
    *,
    source: str = "KBS",
    lookback_days: int = 10,
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
    counts = {"symbols": 0, "prices": 0, "snapshots": 0, "patterns": 0, "failed": 0}
    warnings: list[str] = []
    try:
        symbols = client.active_symbols()
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
                    result = analyze_bars(analysis_rows)
                    indicators = result["indicators"]
                    snapshot = {
                        "symbol_id": symbol_row["id"], "timeframe": "D",
                        "as_of_date": result["as_of_date"], "input_last_date": result["as_of_date"],
                        "algorithm_version": ALGORITHM_VERSION, **indicators,
                    }
                    counts["snapshots"] += client.upsert(
                        "technical_snapshots", [snapshot], "symbol_id,timeframe,as_of_date"
                    )
                    patterns = [{
                        "symbol_id": symbol_row["id"], "timeframe": "D",
                        "pattern_type": pattern["pattern_type"], "state": pattern["state"],
                        "start_date": analysis_rows[pattern["start_index"]]["date"],
                        "end_date": analysis_rows[pattern["end_index"]]["date"],
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
