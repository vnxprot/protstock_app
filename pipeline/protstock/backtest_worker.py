from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .backtest import BacktestAssumptions, run_backtest
from .config import Settings
from .provider_vnstock import KBS_SOURCE_VERSION
from .supabase_rest import SupabaseRestClient


def _evaluation_contexts(daily: list[dict], breadth_rows: list[dict], closed: set[date], symbol: dict | None = None) -> dict[str, dict]:
    breadth = {row["trading_date"]: row for row in breadth_rows}
    result = {}
    for bar in daily:
        day = date.fromisoformat(bar["date"])
        friday = day + timedelta(days=max(0, 4 - day.weekday()))
        week_remaining = {day + timedelta(days=i) for i in range(1, (friday - day).days + 1)}
        month_end = day.replace(day=monthrange(day.year, day.month)[1])
        month_remaining = {day + timedelta(days=i) for i in range(1, (month_end - day).days + 1)
                           if (day + timedelta(days=i)).weekday() < 5}
        market = breadth.get(bar["date"])
        result[bar["date"]] = {
            "symbol_id": (symbol or {}).get("id", 0), "exchange": (symbol or {}).get("exchange"), "sector": (symbol or {}).get("sector", "BACKTEST"),
            "confirmed_week_end": day.weekday() < 5 and week_remaining.issubset(closed),
            "confirmed_month_end": month_remaining.issubset(closed),
            "market_context": ({"trading_date": bar["date"], "breadth": market,
                                "vnindex_snapshot": {"trend_state": market.get("vnindex_trend_state", "UNKNOWN")}} if market else None),
        }
    return result


def process_backtests(limit: int = 3) -> dict[str, Any]:
    client = SupabaseRestClient(Settings.from_env())
    counts = {"succeeded": 0, "failed": 0}
    try:
        for request in client.queued_backtests(limit):
            try:
                client.update_backtest(request["id"], {"status": "RUNNING"}, request["started_at"]) if request.get("started_at") else client.update_backtest(request["id"], {"status": "RUNNING"})
                symbol = client.symbol_by_id(request["symbol_id"]) if hasattr(client, "symbol_by_id") else {"id": request["symbol_id"]}
                research_status = client.research_price_status(request["symbol_id"]) if hasattr(client, "research_price_status") else None
                research_ready = bool(research_status and research_status.get("coverage_status") == "MATCHED"
                                      and research_status.get("source_version") == KBS_SOURCE_VERSION
                                      and research_status.get("requested_start_date", "9999-12-31") <= request["date_from"]
                                      and research_status.get("requested_end_date", "") >= request["date_to"])
                history = client.research_price_history(request["symbol_id"], 5000) if research_ready else client.price_history(request["symbol_id"], 5000)
                price_basis = "KBS_VENDOR_REBASED" if research_ready else "STORED_VERIFIED"
                daily = [{**row, "date": row["trading_date"]} for row in history
                         if row["trading_date"] <= request["date_to"]]
                if not daily:
                    raise ValueError("Không có lịch sử giá trong khoảng đã chọn.")
                start, end = date.fromisoformat(daily[0]["date"]), date.fromisoformat(request["date_to"])
                breadth_getter = getattr(client, "breadth_history", None)
                breadth = breadth_getter(start, end) if breadth_getter else []
                calendar_getter = getattr(client, "closed_trading_sessions", None)
                closed = calendar_getter(symbol.get("exchange") or "HOSE", start, end.replace(day=monthrange(end.year, end.month)[1])) if calendar_getter else set()
                benchmark = []
                if hasattr(client, "market_index") and hasattr(client, "index_prices_in_range"):
                    market_index = client.market_index("VNINDEX")
                    benchmark = [{**row, "date": row["trading_date"]} for row in client.index_prices_in_range(market_index["id"], start, end)]
                contexts = _evaluation_contexts(daily, breadth, closed, symbol)
                assumptions = BacktestAssumptions(**request["assumptions"])
                rule = request.get("rule_dsl") or request.get("rule_versions", {}).get("dsl")
                if not rule:
                    raise ValueError("Thiếu bản chụp phiên bản quy tắc.")
                result = run_backtest(daily, rule, assumptions, date_from=request["date_from"], date_to=request["date_to"],
                                      evaluation_contexts=contexts, timeframe=request["timeframe"], benchmark_rows=benchmark)
                if request.get("algorithm_version") and request["algorithm_version"] != result["algorithm_version"]:
                    raise ValueError("Phiên bản tính toán đã thay đổi; tạo lượt kiểm thử mới để dùng phiên bản hiện tại.")
                trades = [{**trade, "backtest_run_id": request["id"], "symbol_id": request["symbol_id"]} for trade in result["trades"]]
                replace = getattr(client, "replace_backtest_trades", None)
                if replace:
                    replace(request["id"], trades, request["started_at"]) if request.get("started_at") else replace(request["id"], trades)
                elif trades:
                    client.upsert("backtest_trades", trades, "id")
                metrics = {**result["metrics"], "warnings": result["warnings"], "evaluation_summary": result["evaluation_summary"],
                           "execution_model": result["execution_model"], "price_unit": result["price_unit"],
                           "source_price_unit": result["source_price_unit"], "settlement_model": result.get("settlement_model", assumptions.settlement_model),
                           "settlement_exit_timing": result.get("settlement_exit_timing", assumptions.settlement_exit_timing),
                           "execution_algorithm_version": result["algorithm_version"], "execution_data_revision": result["data_revision"], "price_basis": price_basis,
                           "evaluation_period": result.get("evaluation_period")}
                payload = {"status": "SUCCEEDED", "metrics": metrics, "benchmark_metrics": result["benchmark_metrics"],
                           "equity_curve": result["equity_curve"], "finished_at": datetime.now(timezone.utc).isoformat()}
                client.update_backtest(request["id"], payload, request["started_at"]) if request.get("started_at") else client.update_backtest(request["id"], payload)
                counts["succeeded"] += 1
            except Exception as exc:
                failure = {"status": "FAILED", "error_message": str(exc)[:500], "finished_at": datetime.now(timezone.utc).isoformat()}
                try:
                    client.update_backtest(request["id"], failure, request["started_at"]) if request.get("started_at") else client.update_backtest(request["id"], failure)
                except Exception:
                    # A reclaimed lease must never overwrite the newer worker.
                    pass
                counts["failed"] += 1
        return counts
    finally:
        client.close()
