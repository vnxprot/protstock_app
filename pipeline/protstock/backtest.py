from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from statistics import mean, pstdev
from typing import Any, Sequence

from .indicators import calculate_indicators
from .rules import evaluate_rule


@dataclass(frozen=True)
class BacktestAssumptions:
    initial_capital: float = 100_000_000
    fee_rate: float = 0.0015
    sell_tax_rate: float = 0.001
    slippage_rate: float = 0.001
    stop_loss_pct: float = 0.07
    trailing_stop_pct: float = 0.10
    time_stop_bars: int = 20


def run_backtest(bars: Sequence[dict], rule: dict[str, Any], assumptions: BacktestAssumptions | None = None) -> dict[str, Any]:
    config = assumptions or BacktestAssumptions()
    ordered = sorted(bars, key=lambda item: item["date"])
    if len(ordered) < 3:
        raise ValueError("backtest requires at least 3 bars")
    cash, quantity = config.initial_capital, 0
    entry_price = entry_cost = 0.0
    entry_date = ""
    entry_index = 0
    highest_close = 0.0
    trades: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []

    for index in range(len(ordered) - 1):
        bar, next_bar = ordered[index], ordered[index + 1]
        close = float(bar["close"])
        if quantity:
            highest_close = max(highest_close, close)
            loss = close / entry_price - 1
            drawdown = close / highest_close - 1
            held = index - entry_index
            reason = "STOP_LOSS" if loss <= -config.stop_loss_pct else "TRAILING_STOP" if drawdown <= -config.trailing_stop_pct else "TIME_STOP" if held >= config.time_stop_bars else ""
            if reason:
                exit_price = float(next_bar["open"]) * (1 - config.slippage_rate)
                proceeds = quantity * exit_price * (1 - config.fee_rate - config.sell_tax_rate)
                pnl = proceeds - entry_cost
                trades.append(_trade(entry_date, next_bar["date"], entry_price, exit_price, quantity, pnl, entry_cost, reason))
                cash += proceeds
                quantity = 0
        if not quantity:
            snapshot = calculate_indicators(ordered[:index + 1]).to_dict()
            passed, reasons = evaluate_rule(rule, snapshot, ordered[:index + 1])
            if passed:
                entry_price = float(next_bar["open"]) * (1 + config.slippage_rate)
                quantity = int(cash / (entry_price * (1 + config.fee_rate)))
                if quantity:
                    entry_cost = quantity * entry_price * (1 + config.fee_rate)
                    cash -= entry_cost
                    entry_date, entry_index, highest_close = next_bar["date"], index + 1, float(next_bar["close"])
        equity_curve.append({"date": bar["date"], "equity": cash + quantity * close})

    if quantity:
        last = ordered[-1]
        exit_price = float(last["close"]) * (1 - config.slippage_rate)
        proceeds = quantity * exit_price * (1 - config.fee_rate - config.sell_tax_rate)
        pnl = proceeds - entry_cost
        trades.append(_trade(entry_date, last["date"], entry_price, exit_price, quantity, pnl, entry_cost, "END_OF_TEST"))
        cash += proceeds
    equity_curve.append({"date": ordered[-1]["date"], "equity": cash})
    return {
        "metrics": _metrics(equity_curve, trades, config.initial_capital),
        "benchmark_metrics": {"buy_hold_return": float(ordered[-1]["close"]) / float(ordered[0]["open"]) - 1},
        "trades": trades,
        "equity_curve": equity_curve,
        "assumptions": config.__dict__,
    }


def _trade(entry_date: str, exit_date: str, entry_price: float, exit_price: float, quantity: int, pnl: float, cost: float, reason: str) -> dict[str, Any]:
    return {"entry_date": entry_date, "exit_date": exit_date, "entry_price": entry_price, "exit_price": exit_price, "quantity": quantity, "pnl": pnl, "return_pct": pnl / cost if cost else 0, "exit_reason": reason}


def _metrics(curve: Sequence[dict], trades: Sequence[dict], initial: float) -> dict[str, float]:
    returns = [float(curve[i]["equity"]) / float(curve[i - 1]["equity"]) - 1 for i in range(1, len(curve)) if curve[i - 1]["equity"]]
    peak, max_drawdown = float(curve[0]["equity"]), 0.0
    for point in curve:
        equity = float(point["equity"]); peak = max(peak, equity); max_drawdown = min(max_drawdown, equity / peak - 1)
    winners = [float(item["pnl"]) for item in trades if item["pnl"] > 0]
    losers = [float(item["pnl"]) for item in trades if item["pnl"] < 0]
    final = float(curve[-1]["equity"])
    years = max((len(curve) - 1) / 252, 1 / 252)
    return {
        "win_rate": len(winners) / len(trades) if trades else 0,
        "expectancy": mean([float(item["return_pct"]) for item in trades]) if trades else 0,
        "profit_factor": sum(winners) / abs(sum(losers)) if losers else (999.0 if winners else 0),
        "cagr": (final / initial) ** (1 / years) - 1,
        "max_drawdown": max_drawdown,
        "sharpe": mean(returns) / pstdev(returns) * sqrt(252) if len(returns) > 1 and pstdev(returns) else 0,
        "turnover": sum(float(item["entry_price"]) * int(item["quantity"]) + float(item["exit_price"]) * int(item["quantity"]) for item in trades) / initial,
        "total_return": final / initial - 1,
        "trade_count": float(len(trades)),
    }


def walk_forward_windows(length: int, train: int, test: int) -> list[tuple[range, range]]:
    if min(length, train, test) <= 0:
        raise ValueError("length, train and test must be positive")
    return [(range(start, start + train), range(start + train, min(start + train + test, length))) for start in range(0, length - train, test)]

