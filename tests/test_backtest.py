from datetime import date, timedelta

from protstock.backtest import BacktestAssumptions, run_backtest, walk_forward_windows
from protstock.rules import compile_rule


def bars(count: int = 80) -> list[dict]:
    start = date(2025, 1, 1)
    return [{"date": (start + timedelta(days=i)).isoformat(), "open": 10 + i * .1, "high": 10.2 + i * .1, "low": 9.8 + i * .1, "close": 10.1 + i * .1, "volume": 2_000_000} for i in range(count)]


def test_backtest_uses_next_bar_and_reports_required_metrics() -> None:
    rule = compile_rule("Mua khi vượt đỉnh 3 phiên").to_dict()
    result = run_backtest(bars(), rule, BacktestAssumptions(time_stop_bars=5))
    assert result["trades"]
    assert result["trades"][0]["entry_date"] > bars()[3]["date"]
    assert {"win_rate", "expectancy", "profit_factor", "cagr", "max_drawdown", "sharpe", "turnover"} <= result["metrics"].keys()


def test_walk_forward_never_leaks_test_into_train() -> None:
    windows = walk_forward_windows(100, 60, 20)
    assert windows
    assert all(max(train) < min(test) for train, test in windows)
