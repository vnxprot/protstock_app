from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .backtest import BacktestAssumptions, run_backtest
from .config import Settings
from .supabase_rest import SupabaseRestClient
from .timeframes import aggregate_bars


def process_backtests(limit: int = 3) -> dict[str, Any]:
    client = SupabaseRestClient(Settings.from_env())
    counts = {"succeeded": 0, "failed": 0}
    try:
        for request in client.queued_backtests(limit):
            try:
                client.update_backtest(request["id"], {"status": "RUNNING"})
                daily = [{**row, "date": row["trading_date"]} for row in client.price_history(request["symbol_id"], 5000)]
                rows = daily if request["timeframe"] == "D" else aggregate_bars(daily, request["timeframe"])
                rows = [row for row in rows if request["date_from"] <= row["date"] <= request["date_to"]]
                assumptions = BacktestAssumptions(**request["assumptions"])
                result = run_backtest(rows, request["rule_versions"]["dsl"], assumptions)
                trades = [{**trade, "backtest_run_id": request["id"], "symbol_id": request["symbol_id"]} for trade in result["trades"]]
                client.upsert("backtest_trades", trades, "id")
                client.update_backtest(request["id"], {"status": "SUCCEEDED", "metrics": result["metrics"], "benchmark_metrics": result["benchmark_metrics"], "equity_curve": result["equity_curve"], "finished_at": datetime.now(timezone.utc).isoformat()})
                counts["succeeded"] += 1
            except Exception as exc:
                client.update_backtest(request["id"], {"status": "FAILED", "error_message": str(exc)[:500], "finished_at": datetime.now(timezone.utc).isoformat()})
                counts["failed"] += 1
        return counts
    finally:
        client.close()
