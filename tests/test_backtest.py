from datetime import date, timedelta

import pytest

from protstock.backtest import BacktestAssumptions, run_backtest, walk_forward_windows, evaluate_backtest_signal
from protstock.rules import compile_rule, evaluate_rule


def bars(count: int = 80) -> list[dict]:
    start = date(2025, 1, 1)
    return [{"date": (start + timedelta(days=i)).isoformat(), "open": 10 + i * .1, "high": 10.2 + i * .1,
             "low": 9.8 + i * .1, "close": 10.1 + i * .1, "volume": 2_000_000} for i in range(count)]


def contexts(rows):
    # Explicit synthetic external context; production worker uses stored breadth.
    return {row["date"]: {"market_context": {"trading_date": row["date"],
            "breadth": {"pct_above_sma50": 60, "coverage_status": "COMPLETE"},
            "vnindex_snapshot": {"trend_state": "UP"}},
            "multi_timeframe_context": {"monthly_snapshot": {"trend_state": "UP"}}} for row in rows}


def test_backtest_uses_next_bar_and_reports_required_metrics():
    rule = compile_rule("Mua khi vượt đỉnh 3 phiên").to_dict()
    rows = bars()
    result = run_backtest(rows, rule, BacktestAssumptions(time_stop_bars=5), evaluation_contexts=contexts(rows))
    assert result["trades"]
    assert result["trades"][0]["entry_date"] > rows[3]["date"]
    assert {"win_rate", "expectancy", "profit_factor", "cagr", "max_drawdown", "sharpe", "turnover"} <= result["metrics"].keys()


def test_walk_forward_never_leaks_test_into_train():
    windows = walk_forward_windows(100, 60, 20)
    assert windows and all(max(train) < min(test) for train, test in windows)


def test_empty_dsl_does_not_match_and_core_without_setup_does_not_buy():
    assert evaluate_rule({"engine": "core_ladder_v2"}, {}, bars())[0] is False
    result = run_backtest(bars(5), {"engine": "core_ladder_v2", "timeframe": "D"})
    assert result["trades"] == []
    assert result["metrics"]["total_return"] == 0


def test_next_open_order_never_changes_prior_day_equity_and_prices_are_vnd(monkeypatch):
    rows = [{"date": "2026-01-01", "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1_000_000},
            {"date": "2026-01-02", "open": 20, "high": 20, "low": 20, "close": 20, "volume": 1_000_000},
            {"date": "2026-01-03", "open": 20, "high": 20, "low": 20, "close": 20, "volume": 1_000_000}]
    def signal(history, *_args):
        return (True, "PROBE_BUY", ["SETUP"], {"sizing": {"quantity": 5000}, "invalidation_price": 9}) if len(history) == 1 else (False, "WATCH", [], {})
    monkeypatch.setattr("protstock.backtest.evaluate_backtest_signal", signal)
    result = run_backtest(rows, {}, BacktestAssumptions(fee_rate=0, sell_tax_rate=0, slippage_rate=0, risk_pct=100, max_sector_weight_pct=100))
    assert [point["equity"] for point in result["equity_curve"]] == [100_000_000] * 3
    assert result["trades"][0]["quantity"] == 5000
    assert result["trades"][0]["entry_price"] == 20_000
    assert result["trades"][0]["entry_date"] == "2026-01-02"
    assert result["metrics"]["total_return"] == result["metrics"]["sharpe"] == result["metrics"]["max_drawdown"] == 0


def test_watch_and_risk_actions_never_become_entry_orders(monkeypatch):
    for action in ("WATCH", "EXIT", "REDUCE"):
        monkeypatch.setattr("protstock.backtest.evaluate_backtest_signal", lambda *_args: (True, action, [action], {"sizing": {"quantity": 5000}}))
        assert run_backtest(bars(3), {})["trades"] == []


def test_exit_executes_next_open_with_costs_and_no_same_open_reentry(monkeypatch):
    rows = [{**row, "open": 20, "high": 21, "low": 19, "close": 20} for row in bars(4)]
    def signal(history, *_args):
        if len(history) == 1:
            return True, "PROBE_BUY", ["SETUP"], {"sizing": {"quantity": 1000}, "invalidation_price": 18}
        if len(history) == 2:
            return True, "EXIT", ["RULE_EXIT"], {}
        return False, "WATCH", [], {}
    monkeypatch.setattr("protstock.backtest.evaluate_backtest_signal", signal)
    config = BacktestAssumptions(fee_rate=.0015, sell_tax_rate=.001, slippage_rate=.001, risk_pct=100, max_sector_weight_pct=100)
    result = run_backtest(rows, {}, config)
    assert len(result["trades"]) == 1
    trade = result["trades"][0]
    assert trade["entry_date"] == rows[1]["date"] and trade["exit_date"] == rows[2]["date"]
    assert trade["exit_reason"] == "RULE_EXIT"
    expected = 1000 * 19980 * (1 - .0015 - .001) - 1000 * 20020 * (1 + .0015)
    assert trade["pnl"] == pytest.approx(expected)
    assert result["equity_curve"][0]["equity"] == 100_000_000


def test_reduce_sells_only_half_position_and_records_proportional_cost(monkeypatch):
    def signal(history, *_args):
        if len(history) == 1: return True, "PROBE_BUY", ["SETUP"], {"sizing": {"quantity": 1000}, "invalidation_price": 8}
        if len(history) == 2: return True, "REDUCE", ["RULE_REDUCE"], {}
        return False, "WATCH", [], {}
    monkeypatch.setattr("protstock.backtest.evaluate_backtest_signal", signal)
    result = run_backtest(bars(4), {}, BacktestAssumptions(fee_rate=0, sell_tax_rate=0, slippage_rate=0, risk_pct=100, max_sector_weight_pct=100))
    assert [trade["quantity"] for trade in result["trades"]] == [500, 500]
    assert result["trades"][0]["exit_reason"] == "RULE_REDUCE"


def test_indicators_have_preperiod_warmup_without_preperiod_orders():
    rows = bars(225)
    rule = compile_rule("Mua khi MA20 > MA50 > MA200").to_dict()
    result = run_backtest(rows, rule, BacktestAssumptions(max_sector_weight_pct=100), date_from=rows[200]["date"], evaluation_contexts=contexts(rows))
    assert result["trades"] and result["trades"][0]["entry_date"] == rows[201]["date"]
    assert result["equity_curve"][0]["date"] == rows[200]["date"]
    assert result["equity_curve"][0]["equity"] == 100_000_000
    cold = run_backtest(rows[200:], rule, evaluation_contexts=contexts(rows))
    assert not cold["trades"]


def test_missing_market_context_blocks_entries_with_visible_reason():
    result = run_backtest(bars(), compile_rule("Mua khi vượt đỉnh 3 phiên").to_dict())
    assert not result["trades"]
    assert "MARKET_CONTEXT_MISSING" in result["warnings"]
    assert result["evaluation_summary"]["entry_blocked"] > 0


def test_future_bars_do_not_change_cutoff_results_or_data_revision():
    rows = bars(45)
    rule = compile_rule("Mua khi vượt đỉnh 3 phiên").to_dict()
    ctx = contexts(rows)
    full = run_backtest(rows, rule, date_to=rows[30]["date"], evaluation_contexts=ctx)
    prefix = run_backtest(rows[:31], rule, evaluation_contexts={k: v for k, v in ctx.items() if k <= rows[30]["date"]})
    assert full["trades"] == prefix["trades"]
    assert full["equity_curve"] == prefix["equity_curve"]
    assert full["data_revision"] == prefix["data_revision"]


def test_pattern_rules_receive_detected_evidence_and_stop_rules_receive_position(monkeypatch):
    rows = bars(35)
    def analyzed(source, **kwargs):
        return {"indicators": {"close": source[-1]["close"], "atr14": .2, "trend_state": "UP"},
                "patterns": [{"pattern_type": "DOUBLE_BOTTOM", "state": "CONFIRMED", "direction": "BULLISH",
                              "quality_score": 90, "invalidation_price": 9}], "classical_patterns": [], "zones": []}
    monkeypatch.setattr("protstock.backtest.analyze_bars", analyzed)
    config = BacktestAssumptions()
    matched, action, reasons, evidence = evaluate_backtest_signal(rows, compile_rule("Mua khi hai đáy xác nhận").to_dict(),
        None, 100_000_000, config, contexts(rows)[rows[-1]["date"]])
    assert matched and action == "PROBE_BUY" and "pattern:PASS" in reasons
    assert evidence["invalidation_price"] == 9
    position = {"quantity": 100, "average_cost": 20, "entry_date": rows[0]["date"]}
    assert evaluate_backtest_signal(rows, compile_rule("Bán cắt lỗ 7%").to_dict(), position,
        100_000_000, config, contexts(rows)[rows[-1]["date"]])[1] == "EXIT"


@pytest.mark.parametrize("config", [BacktestAssumptions(initial_capital=0), BacktestAssumptions(fee_rate=-1),
                                    BacktestAssumptions(lot_size=0), BacktestAssumptions(slippage_rate=1)])
def test_invalid_assumptions_are_rejected(config):
    with pytest.raises(ValueError):
        run_backtest(bars(3), {}, config)


def test_gap_open_rechecks_risk_and_skips_unaffordable_lot(monkeypatch):
    rows = [{"date": "2026-01-01", "open": 10, "high": 10, "low": 10, "close": 10, "volume": 1_000_000},
            {"date": "2026-01-02", "open": 20, "high": 20, "low": 20, "close": 20, "volume": 1_000_000},
            {"date": "2026-01-03", "open": 20, "high": 20, "low": 20, "close": 20, "volume": 1_000_000}]
    def signal(history, *_args):
        return (True, "PROBE_BUY", ["SETUP"], {"sizing": {"quantity": 5000}, "invalidation_price": 9}) if len(history) == 1 else (False, "WATCH", [], {})
    monkeypatch.setattr("protstock.backtest.evaluate_backtest_signal", signal)
    result = run_backtest(rows, {}, BacktestAssumptions(fee_rate=0, sell_tax_rate=0, slippage_rate=0))
    assert result["trades"] == []
    assert result["evaluation_summary"]["unfilled_orders"] == 1
    assert result["metrics"]["total_return"] == 0


def test_rule_percent_stop_is_based_on_actual_fill_and_executes_next_open(monkeypatch):
    prices = [(10, 10), (12, 11.5), (11.5, 11), (11.5, 11.5)]
    rows = [{"date": "2026-01-0" + str(i + 1), "open": open_price, "close": close,
             "high": max(open_price, close) + .1, "low": min(open_price, close) - .1, "volume": 1_000_000}
            for i, (open_price, close) in enumerate(prices)]
    def signal(history, *_args):
        return (True, "PROBE_BUY", ["SETUP"], {"sizing": {"quantity": 1000}, "invalidation_price": 9.3,
                                             "stop_basis": "RULE_PERCENT"}) if len(history) == 1 else (False, "WATCH", [], {})
    monkeypatch.setattr("protstock.backtest.evaluate_backtest_signal", signal)
    result = run_backtest(rows, {"risk": {"stop_loss_pct": .07}},
        BacktestAssumptions(fee_rate=0, sell_tax_rate=0, slippage_rate=0, max_sector_weight_pct=100))
    assert result["trades"][0]["entry_price"] == 12000
    assert result["trades"][0]["exit_date"] == "2026-01-04"
    assert result["trades"][0]["exit_reason"] == "STOP_LOSS"

@pytest.mark.parametrize("metadata,pattern", [
    ({"quality_status": "QUARANTINED"}, "cách ly"),
    ({"price_unit": "VND_PER_SHARE"}, "Đơn vị"),
    ({"price_unit": "LEGACY_UNVERIFIED"}, "Đơn vị"),
    ({"source_version": "LEGACY_UNVERIFIED"}, "Nguồn"),
])
def test_backtest_rejects_quarantined_or_unverified_price_provenance(metadata, pattern):
    with pytest.raises(ValueError, match=pattern):
        run_backtest([{**row, **metadata} for row in bars(3)], {})


def test_backtest_macd_zone_receives_real_symbol_and_exchange(monkeypatch):
    seen = []
    def engine(name, overrides, context):
        seen.append((name, context["symbol_id"], context["candidate_exchange"]))
        return False, "WATCH", []
    monkeypatch.setattr("protstock.backtest.evaluate_named_engine", engine)
    rows = bars(45)
    evaluate_backtest_signal(rows, {"engine": "macd_bullish_divergence_v4"}, None, 100_000_000,
                            BacktestAssumptions(), {"symbol_id": 616, "exchange": "HNX"})
    assert seen == [("macd_bullish_divergence_v4", 616, "HNX")]


def test_verified_series_with_discontinuous_price_basis_cannot_create_trade_returns():
    rows = bars(3)
    rows[1] = {**rows[1], "open": 50, "high": 51, "low": 49, "close": 50}
    with pytest.raises(ValueError, match="thay đổi cơ sở"):
        run_backtest([{**row, "source_version": "KBS_PUBLIC_V2_20260930"} for row in rows], {})
