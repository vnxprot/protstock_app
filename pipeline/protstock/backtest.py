from __future__ import annotations

from calendar import monthrange
from copy import deepcopy
from dataclasses import dataclass, asdict
from datetime import date
from hashlib import sha256
import json
from math import isfinite, sqrt
from statistics import mean, pstdev
from typing import Any, Sequence

from .analysis import ALGORITHM_VERSION, analyze_bars
from .decision_context import reconcile_proposal
from .engines import evaluate_named_engine
from .fibonacci import build_fibonacci_context
from .indicators import calculate_indicators
from .period_signals import monthly_trend, evaluate_period_signal
from .provider_vnstock import STOCK_PRICE_UNIT
from .signal_policy import apply_signal_policy, STOCK_PRICE_TO_VND
from .timeframes import aggregate_bars
from .wyckoff import classify_wyckoff_timeframe


@dataclass(frozen=True)
class BacktestAssumptions:
    initial_capital: float = 100_000_000
    fee_rate: float = 0.0015
    sell_tax_rate: float = 0.001
    slippage_rate: float = 0.001
    stop_loss_pct: float = 0.07
    trailing_stop_pct: float = 0.10
    time_stop_bars: int = 20
    risk_pct: float = 1.0
    lot_size: int = 100
    max_sector_weight_pct: float = 30.0
    settlement_days: float = 2.0
    settlement_model: str = "T_PLUS_VIETNAM"
    settlement_exit_timing: str = "NEXT_OPEN"

    def validate(self) -> None:
        if not isfinite(self.initial_capital) or self.initial_capital <= 0:
            raise ValueError("initial_capital must be positive VND")
        for key in ("fee_rate", "sell_tax_rate", "slippage_rate", "stop_loss_pct", "trailing_stop_pct"):
            value = getattr(self, key)
            if not isfinite(value) or not 0 <= value < 1:
                raise ValueError(f"{key} must be in [0, 1)")
        if self.fee_rate + self.sell_tax_rate >= 1:
            raise ValueError("total sell costs must be below 100%")
        if not isinstance(self.time_stop_bars, int) or not isinstance(self.lot_size, int) or self.time_stop_bars <= 0 or self.lot_size <= 0 or not 0 < self.risk_pct <= 100:
            raise ValueError("time_stop_bars, lot_size and risk_pct must be positive")
        if not 0 < self.max_sector_weight_pct <= 100:
            raise ValueError("max_sector_weight_pct must be in (0,100]")
        if self.settlement_model != "T_PLUS_VIETNAM":
            raise ValueError("unsupported settlement_model")
        if self.settlement_model == "T_PLUS_VIETNAM" and self.settlement_days != 2.0:
            raise ValueError("Vietnam settlement requires T+2 afternoon")
        if self.settlement_exit_timing not in {"T2_CLOSE", "NEXT_OPEN"}:
            raise ValueError("unsupported settlement_exit_timing")


def _closed_periods(history: list[dict], timeframe: str, context: dict) -> list[dict]:
    day = date.fromisoformat(history[-1]["date"])
    # Week/month end may be explicitly verified by the worker calendar.
    week_end = day if context.get("confirmed_week_end") or day.weekday() == 4 else None
    month_end = day if context.get("confirmed_month_end") or day.day == monthrange(day.year, day.month)[1] else None
    return [row for row in aggregate_bars(history, timeframe, week_end, month_end) if row["is_complete"]]


def evaluate_backtest_signal(history: list[dict], rule: dict, position: dict | None,
                             capital: float, config: BacktestAssumptions,
                             evaluation_context: dict | None = None, timeframe: str = "D") -> tuple[bool, str, list[str], dict]:
    """Use the live dispatcher, chart reconciliation and shared safety policy.

    Historical external context must be explicitly supplied. Missing breadth
    never becomes an assumed healthy market to manufacture a backtest entry.
    """
    supplied = dict(evaluation_context or {})
    day = history[-1]["date"]
    weekly_rows, monthly_rows = (_closed_periods(history, frame, supplied) for frame in ("W", "M"))
    weekly = analyze_bars(weekly_rows, timeframe="W") if weekly_rows else {}
    mtf = {"weekly_patterns": weekly.get("patterns", []), "weekly_snapshot": weekly.get("indicators", {}),
           "monthly_snapshot": monthly_trend(monthly_rows)}
    mtf.update(supplied.get("multi_timeframe_context") or {})
    rows = history if timeframe == "D" else weekly_rows if timeframe == "W" else monthly_rows
    if not rows or (timeframe != "D" and rows[-1]["date"] != day):
        return False, "WATCH", [], {}
    daily_snapshot = calculate_indicators(history).to_dict()
    fib = build_fibonacci_context(history,
        date.fromisoformat(day) if supplied.get("confirmed_week_end") or date.fromisoformat(day).weekday() == 4 else None,
        date.fromisoformat(day) if supplied.get("confirmed_month_end") or date.fromisoformat(day).day == monthrange(date.fromisoformat(day).year, date.fromisoformat(day).month)[1] else None)
    benchmark = [row for row in supplied.get("benchmark_rows", []) if row["date"] <= day]
    result = analyze_bars(rows, benchmark_rows=benchmark or None, fibonacci_context=fib, timeframe=timeframe)
    context = {"dsl": rule, "symbol_id": supplied.get("symbol_id", 0), "candidate_exchange": supplied.get("exchange"), "timeframe": timeframe, "bars": rows, "snapshot": result["indicators"],
               "patterns": result["patterns"], "classical_patterns": result.get("classical_patterns", []),
               "zones": result["zones"], "fibonacci_context": fib, "position": position,
               "market_context": supplied.get("market_context"), "multi_timeframe_context": mtf,
               "wyckoff_context": classify_wyckoff_timeframe(timeframe, rows, period_event=True),
               "daily_snapshot": daily_snapshot, "evaluation_date": day, "data_date": day,
               "capital": capital, "risk_pct": config.risk_pct, "lot_size": config.lot_size, "max_sector_weight_pct": config.max_sector_weight_pct,
               "candidate_sector": supplied.get("sector", "BACKTEST"),
               "portfolio_positions": ([{"quantity": position["quantity"], "market_price": float(history[-1]["close"]) * STOCK_PRICE_TO_VND,
                                         "sector": supplied.get("sector", "BACKTEST")}] if position else []),
               "period_event": True, "engine_evidence": {}}
    context["rule_context"] = {**supplied, "position": position}
    if timeframe in {"W", "M"} and rule.get("engine") == "core_ladder_v2":
        passed, action, reasons = evaluate_period_signal(timeframe, context)
    else:
        proposal = {**context, "portfolio_positions": None}
        passed, action, reasons = evaluate_named_engine(rule.get("engine"), rule.get("overrides"), proposal)
        context["engine_evidence"] = proposal.get("engine_evidence", {})
    if passed:
        action, reasons = reconcile_proposal(action, reasons, timeframe=timeframe,
            patterns=[*result["patterns"], *result.get("classical_patterns", [])],
            weekly_patterns=[*weekly.get("patterns", []), *weekly.get("classical_patterns", [])])
        if timeframe in {"W", "M"} and action in {"PROBE_BUY", "ADD"}:
            action, reasons = "WATCH", [*reasons, "DAILY_TRIGGER_REQUIRED"]
        matched = [p for p in result["patterns"] if p.get("state") == "CONFIRMED"
                   and any(p["pattern_type"] in reason for reason in reasons)]
        if matched and not context["engine_evidence"].get("invalidation_price"):
            context["engine_evidence"]["invalidation_price"] = max(matched, key=lambda p: p["quality_score"])["invalidation_price"]
        stop_pct = (rule.get("risk") or {}).get("stop_loss_pct")
        if stop_pct and action in {"PROBE_BUY", "ADD"}:
            context["engine_evidence"]["invalidation_price"] = float(history[-1]["close"]) * (1 - float(stop_pct))
            context["engine_evidence"]["stop_basis"] = "RULE_PERCENT"
    if passed or position:
        action, reasons = apply_signal_policy(action if passed else "WATCH", reasons, context)
        passed = passed or action == "EXIT"
    return passed, action, reasons, context["engine_evidence"]


def run_backtest(bars: Sequence[dict], rule: dict[str, Any], assumptions: BacktestAssumptions | None = None,
                 *, date_from: str | None = None, date_to: str | None = None,
                 evaluation_contexts: dict[str, dict] | None = None, timeframe: str = "D",
                 benchmark_rows: Sequence[dict] = ()) -> dict[str, Any]:
    """Daily event ledger: execute yesterday's order at today's open, then mark close.

    Input stock OHLC uses thousand VND/share; ledger prices/cash/PnL use VND.
    Pre-period bars warm indicators but cannot place an order before date_from.
    Stops are evaluated on closed bars and filled at the next available open.
    """
    config = assumptions or BacktestAssumptions()
    config.validate()
    if timeframe not in {"D", "W", "M"}:
        raise ValueError("unsupported timeframe")
    ordered = sorted((dict(row) for row in bars if row.get("is_complete") is not False), key=lambda item: item["date"])
    if len(ordered) < 3:
        raise ValueError("backtest requires at least 3 completed daily bars")
    if len({row["date"] for row in ordered}) != len(ordered):
        raise ValueError("duplicate trading dates")
    start, end = date_from or ordered[0]["date"], date_to or ordered[-1]["date"]
    if start > end:
        raise ValueError("date_to must be on or after date_from")
    ordered = [row for row in ordered if row["date"] <= end]
    evaluation_contexts = {day: ctx for day, ctx in (evaluation_contexts or {}).items() if day <= end}
    benchmark_rows = [row for row in benchmark_rows if row["date"] <= end]
    if not any(row["date"] >= start for row in ordered):
        raise ValueError("no prices in requested period")
    for row in ordered:
        if any(not isfinite(float(row[key])) or float(row[key]) <= 0 for key in ("open", "high", "low", "close")):
            raise ValueError("invalid OHLC")
        if row.get("quality_status", "VALID") != "VALID":
            raise ValueError("Dữ liệu giá đang cách ly; xác minh lịch sử trước khi kiểm thử.")
        if row.get("price_unit") is not None and row["price_unit"] != STOCK_PRICE_UNIT:
            raise ValueError("Đơn vị giá chưa được xác minh là nghìn đồng/cổ phiếu.")
        if row.get("source_version") == "LEGACY_UNVERIFIED":
            raise ValueError("Nguồn giá lịch sử chưa được xác minh.")
    if any(row.get("source_version") for row in ordered) and any(
        not .5 < float(right["close"]) / float(left["close"]) < 2 for left, right in zip(ordered, ordered[1:])
    ):
        raise ValueError("Chuỗi giá có thay đổi cơ sở chưa xác minh; cần lịch sử research nhất quán.")
    cash, quantity, entry_price, entry_cost = config.initial_capital, 0, 0.0, 0.0
    entry_date, entry_index, highest_close, stop_price = "", 0, 0.0, 0.0
    pending: dict | None = None
    lots: list[dict[str, Any]] = []
    all_lots: list[dict[str, Any]] = []
    locked_breaches = 0
    trades: list[dict] = []
    curve: list[dict] = []
    evaluations: list[dict] = []
    counts = {"evaluated": 0, "market_context_missing": 0, "entry_blocked": 0, "unfilled_orders": 0}
    effective_stop_pct = float((rule.get("risk") or {}).get("stop_loss_pct", config.stop_loss_pct))
    if not 0 <= effective_stop_pct < 1:
        raise ValueError("rule stop_loss_pct must be in [0,1)")

    def available(index: int) -> int:
        return sum(lot["quantity"] for lot in lots if index >= lot["entry_index"] + 3)

    def sell(bar: dict, amount: int, reason: str, *, at_close: bool = False) -> None:
        nonlocal cash, quantity, entry_cost
        price = float(bar["close"] if at_close else bar["open"]) * STOCK_PRICE_TO_VND * (1 if at_close else 1 - config.slippage_rate)
        cost = entry_cost * amount / quantity
        proceeds = amount * price * (1 - config.fee_rate - config.sell_tax_rate)
        trades.append(_trade(entry_date, bar["date"], entry_price, price, amount, proceeds - cost, cost, reason))
        cash += proceeds
        entry_cost -= cost
        quantity -= amount
        remaining = amount
        for lot in lots:
            eligible = index >= lot["entry_index"] + (2 if at_close else 3)
            taken = min(remaining, lot["quantity"]) if eligible else 0
            lot["quantity"] -= taken
            remaining -= taken
            if not remaining:
                break
        lots[:] = [lot for lot in lots if lot["quantity"]]

    for index, bar in enumerate(ordered):
        if bar["date"] < start:
            continue
        close_vnd = float(bar["close"]) * STOCK_PRICE_TO_VND
        if pending:
            if pending["action"] in {"EXIT", "REDUCE"} and quantity:
                amount = quantity if pending["action"] == "EXIT" else max(config.lot_size, (quantity // 2 // config.lot_size) * config.lot_size)
                filled = min(amount, available(index))
                if filled:
                    sell(bar, filled, pending["reason"])
                if filled < amount:
                    pending["remaining"] = amount - filled
                    counts["locked_exit_deferred"] = counts.get("locked_exit_deferred", 0) + 1
                else:
                    pending = None
            elif pending["action"] in {"PROBE_BUY", "ADD"}:
                price = float(bar["open"]) * STOCK_PRICE_TO_VND * (1 + config.slippage_rate)
                budget_quantity = int(cash / (price * (1 + config.fee_rate)))
                # The shared policy size is in actual shares, never thousand-share units.
                wanted = int((pending["evidence"].get("sizing") or {}).get("quantity") or 0)
                proposed_stop = float(pending["evidence"].get("invalidation_price") or 0) * STOCK_PRICE_TO_VND
                fill_stop = price * (1 - effective_stop_pct) if pending["evidence"].get("stop_basis") == "RULE_PERCENT" else proposed_stop or price * (1 - effective_stop_pct)
                # Recheck at the observed open: a gap must not enlarge risk or
                # concentration beyond the policy selected at yesterday's close.
                opening_value = quantity * float(bar["open"]) * STOCK_PRICE_TO_VND
                opening_equity = cash + opening_value
                risk_quantity = int(opening_equity * config.risk_pct / 100 / (price - fill_stop)) if 0 < fill_stop < price else 0
                sector_budget = max(0.0, opening_equity * config.max_sector_weight_pct / 100 - opening_value)
                sector_quantity = int(sector_budget / price)
                amount = min(wanted, budget_quantity, risk_quantity, sector_quantity) // config.lot_size * config.lot_size
                if amount:
                    cost = amount * price * (1 + config.fee_rate)
                    entry_price = (entry_price * quantity + price * amount) / (quantity + amount)
                    entry_cost += cost
                    cash -= cost
                    if not quantity:
                        entry_date, entry_index, highest_close = bar["date"], index, close_vnd
                    quantity += amount
                    lot = {"quantity": amount, "entry_index": index, "entry_price": price,
                           "locked_drawdown": 0.0, "t_plus_return": None, "breached": False}
                    lots.append(lot)
                    all_lots.append(lot)
                    stop_price = max(stop_price, fill_stop) if pending["action"] == "ADD" else fill_stop
                else:
                    counts["unfilled_orders"] += 1
                pending = None
        for lot in lots:
            age = index - lot["entry_index"]
            if age <= 2:
                # Daily low on T+2 is a conservative proxy: OHLC cannot isolate morning trades.
                lot["locked_drawdown"] = min(lot["locked_drawdown"], float(bar["low"]) * STOCK_PRICE_TO_VND / lot["entry_price"] - 1)
            if age == 2 and lot["t_plus_return"] is None:
                net_exit = close_vnd * (1 - config.fee_rate - config.sell_tax_rate)
                lot["t_plus_return"] = net_exit / (lot["entry_price"] * (1 + config.fee_rate)) - 1
            if age < 2 and not lot["breached"] and stop_price and close_vnd < stop_price:
                lot["breached"] = True
                locked_breaches += 1
        if (config.settlement_exit_timing == "T2_CLOSE"
                and pending and pending["action"] == "EXIT" and pending["reason"] == "LOCKED_STOP_BREACH"):
            ready_at_close = sum(lot["quantity"] for lot in lots if index >= lot["entry_index"] + 2)
            filled = min(pending.get("remaining", quantity), ready_at_close)
            if filled:
                sell(bar, filled, pending["reason"], at_close=True)
                pending = None if not quantity else {**pending, "remaining": quantity}
        curve.append({"date": bar["date"], "equity": cash + quantity * close_vnd})
        history = ordered[:index + 1]
        position = ({"quantity": quantity, "entry_date": entry_date, "average_cost": entry_price / STOCK_PRICE_TO_VND,
                     "invalidation_price": stop_price / STOCK_PRICE_TO_VND} if quantity else None)
        passed, action, reasons, evidence = evaluate_backtest_signal(history, rule, position, cash + quantity * close_vnd,
            config, {**((evaluation_contexts or {}).get(bar["date"]) or {}), "benchmark_rows": benchmark_rows}, timeframe)
        counts["evaluated"] += 1
        counts["market_context_missing"] += int("MARKET_CONTEXT_MISSING" in reasons)
        counts["entry_blocked"] += int("ENTRY_BLOCKED" in reasons)
        if quantity:
            highest_close = max(highest_close, close_vnd)
            stop_reason = ("STOP_LOSS" if effective_stop_pct and close_vnd / entry_price - 1 <= -effective_stop_pct
                           else "TRAILING_STOP" if config.trailing_stop_pct and close_vnd / highest_close - 1 <= -config.trailing_stop_pct
                           else "TIME_STOP" if index - entry_index >= config.time_stop_bars else "")
            if stop_reason:
                passed, action, reasons = True, "EXIT", [stop_reason, *reasons]
            if any(lot["breached"] and index - lot["entry_index"] < 2 for lot in lots):
                passed, action, reasons = True, "EXIT", ["LOCKED_STOP_BREACH", *reasons]
        evaluations.append({"date": bar["date"], "action": action, "matched": passed, "reasons": reasons})
        if passed and action in {"PROBE_BUY", "ADD", "REDUCE", "EXIT"} and index + 1 < len(ordered):
            if not pending or pending["action"] not in {"EXIT", "REDUCE"}:
                pending = {"action": action, "reason": reasons[0] if reasons else action, "evidence": evidence}
    if quantity:
        # Only settled shares may be liquidated; unsettled shares remain marked to market.
        last = ordered[-1]
        final_index = len(ordered) - 1
        final_exit_age = 2 if config.settlement_exit_timing == "T2_CLOSE" else 3
        final_ready = sum(lot["quantity"] for lot in lots if final_index >= lot["entry_index"] + final_exit_age)
        if final_ready:
            price = float(last["close"]) * STOCK_PRICE_TO_VND
            cost = entry_cost * final_ready / quantity
            proceeds = final_ready * price * (1 - config.fee_rate - config.sell_tax_rate)
            trades.append(_trade(entry_date, last["date"], entry_price, price, final_ready, proceeds - cost, cost, "END_OF_TEST"))
            cash += proceeds
            quantity -= final_ready
            curve[-1]["equity"] = cash + quantity * float(last["close"]) * STOCK_PRICE_TO_VND
    traded_rows = [row for row in ordered if row["date"] >= start]
    revision = sha256(json.dumps({"bars": ordered, "contexts": evaluation_contexts or {}, "benchmark": list(benchmark_rows)}, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    matured = [lot for lot in all_lots if lot["t_plus_return"] is not None]
    # Keep the exposure measurements independent of whether a lot later sold.
    return {"metrics": {**_metrics(curve, trades, config.initial_capital),
            "t_plus_win_rate": sum(lot["t_plus_return"] > 0 for lot in matured) / len(matured) if matured else None,
            "locked_drawdown_max": min((lot["locked_drawdown"] for lot in all_lots), default=None),
            "locked_stop_breach_count": locked_breaches},
            "benchmark_metrics": {"buy_hold_return": float(traded_rows[-1]["close"]) / float(traded_rows[0]["open"]) - 1},
            "trades": trades, "equity_curve": curve, "assumptions": asdict(config),
            "rule_snapshot": deepcopy(rule), "algorithm_version": ALGORITHM_VERSION, "data_revision": revision,
            "evaluation_summary": counts, "evaluations": evaluations,
            "evaluation_period": {"requested_from": start, "requested_to": end, "first_date": curve[0]["date"], "last_date": curve[-1]["date"]},
            "warnings": (["MARKET_CONTEXT_MISSING"] if counts["market_context_missing"] else []) +
                        (["HIGHER_TIMEFRAME_CONTEXT_ONLY"] if timeframe != "D" else []),
            "execution_model": "CLOSE_SIGNAL_NEXT_OPEN", "settlement_model": config.settlement_model,
            "settlement_exit_timing": config.settlement_exit_timing, "price_unit": "VND", "source_price_unit": "THOUSAND_VND"}


def _trade(entry_date: str, exit_date: str, entry_price: float, exit_price: float, quantity: int, pnl: float, cost: float, reason: str) -> dict[str, Any]:
    return {"entry_date": entry_date, "exit_date": exit_date, "entry_price": entry_price, "exit_price": exit_price,
            "quantity": quantity, "pnl": pnl, "return_pct": pnl / cost if cost else 0, "exit_reason": reason,
            "evidence": {"price_unit": "VND", "execution_model": "CLOSE_SIGNAL_NEXT_OPEN"}}


def _metrics(curve: Sequence[dict], trades: Sequence[dict], initial: float) -> dict[str, float | None]:
    if not curve:
        raise ValueError("equity curve cannot be empty")
    values = [initial, *(float(point["equity"]) for point in curve)]
    returns = [values[i] / values[i - 1] - 1 for i in range(1, len(values)) if values[i - 1] > 0]
    peak, max_drawdown = initial, 0.0
    for point in curve:
        equity = float(point["equity"])
        peak = max(peak, equity)
        max_drawdown = min(max_drawdown, equity / peak - 1)
    winners = [float(item["pnl"]) for item in trades if item["pnl"] > 0]
    losers = [float(item["pnl"]) for item in trades if item["pnl"] < 0]
    final = float(curve[-1]["equity"])
    years = max((date.fromisoformat(curve[-1]["date"]) - date.fromisoformat(curve[0]["date"])).days / 365.25, 1 / 365.25)
    return {"win_rate": len(winners) / len(trades) if trades else 0,
            "expectancy": mean([float(item["return_pct"]) for item in trades]) if trades else 0,
            "profit_factor": sum(winners) / abs(sum(losers)) if losers else None,
            "cagr": (final / initial) ** (1 / years) - 1,
            "max_drawdown": max_drawdown,
            "sharpe": mean(returns) / pstdev(returns) * sqrt(252) if len(returns) > 1 and pstdev(returns) else 0,
            "turnover": sum(float(item["entry_price"]) * int(item["quantity"]) + float(item["exit_price"]) * int(item["quantity"]) for item in trades) / initial,
            "total_return": final / initial - 1, "trade_count": float(len(trades))}


def walk_forward_windows(length: int, train: int, test: int) -> list[tuple[range, range]]:
    if min(length, train, test) <= 0:
        raise ValueError("length, train and test must be positive")
    return [(range(start, start + train), range(start + train, min(start + train + test, length))) for start in range(0, length - train, test)]
