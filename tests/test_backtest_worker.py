from datetime import date

from protstock.backtest_worker import process_backtests, _evaluation_contexts


def request():
    return {"id": "run", "symbol_id": 7, "timeframe": "D", "date_from": "2026-01-02", "date_to": "2026-01-03",
            "started_at": "lease-1", "rule_dsl": {"engine": "core_ladder_v2"},
            "algorithm_version": "core-rules-v4.0.0", "data_revision": "published-revision",
            "rule_versions": {"dsl": {"all": [], "action": "WATCH"}}, "assumptions": {"initial_capital": 100_000_000}}


def test_worker_keeps_warmup_and_uses_frozen_rule_snapshot_and_lease(monkeypatch):
    updates, replacements, calls = [], [], []
    class Client:
        def queued_backtests(self, _limit): return [request()]
        def price_history(self, *_args):
            return [{"trading_date": "2026-01-0" + str(i), "open": 20, "high": 21, "low": 19, "close": 20, "volume": 1000} for i in range(1, 5)]
        def breadth_history(self, start, end):
            assert start == date(2026, 1, 1) and end == date(2026, 1, 3)
            return []
        def closed_trading_sessions(self, *_args): return set()
        def update_backtest(self, run_id, payload, lease=None):
            # Reproduce the immutable request trigger in the migration.
            assert not {"rule_dsl", "rule_hash", "algorithm_version", "data_revision"}.intersection(payload)
            updates.append((run_id, payload, lease))
        def replace_backtest_trades(self, run_id, rows, lease=None): replacements.append((run_id, rows, lease))
        def close(self): pass
    def simulate(rows, rule, assumptions, **kwargs):
        calls.append((rows, rule, assumptions, kwargs))
        return {"trades": [], "metrics": {"total_return": 0}, "warnings": ["MARKET_CONTEXT_MISSING"],
                "evaluation_summary": {"evaluated": 2}, "execution_model": "CLOSE_SIGNAL_NEXT_OPEN",
                "price_unit": "VND", "source_price_unit": "THOUSAND_VND", "benchmark_metrics": {}, "equity_curve": [],
                "algorithm_version": "core-rules-v4.0.0", "data_revision": "data-hash"}
    monkeypatch.setattr("protstock.backtest_worker.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.backtest_worker.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.backtest_worker.run_backtest", simulate)
    assert process_backtests() == {"succeeded": 1, "failed": 0}
    rows, rule, _, kwargs = calls[0]
    assert rows[0]["date"] == "2026-01-01"  # Before date_from is kept for warm-up.
    assert rows[-1]["date"] == "2026-01-03"  # Future rows are excluded.
    assert rule == request()["rule_dsl"] and kwargs["date_from"] == "2026-01-02"
    assert replacements == [("run", [], "lease-1")]  # Clears any trades left by a prior attempt.
    assert all(update[2] == "lease-1" for update in updates)
    assert updates[-1][1]["metrics"]["execution_algorithm_version"] == "core-rules-v4.0.0"
    assert updates[-1][1]["metrics"]["execution_data_revision"] == "data-hash"
    assert updates[-1][1]["metrics"]["warnings"] == ["MARKET_CONTEXT_MISSING"]


def test_worker_failure_preserves_lease_and_reports_message(monkeypatch):
    updates = []
    class Client:
        def queued_backtests(self, _limit): return [request()]
        def price_history(self, *_args): return []
        def update_backtest(self, run_id, payload, lease=None): updates.append((payload, lease))
        def close(self): pass
    monkeypatch.setattr("protstock.backtest_worker.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.backtest_worker.Settings.from_env", lambda: object())
    assert process_backtests() == {"succeeded": 0, "failed": 1}
    assert updates[-1][0]["status"] == "FAILED" and "lịch sử giá" in updates[-1][0]["error_message"]
    assert updates[-1][1] == "lease-1"


def test_context_does_not_borrow_prior_day_breadth_and_holidays_close_periods():
    day = "2026-09-29"
    rows = [{"date": day}]
    prior = [{"trading_date": "2026-09-28", "vnindex_trend_state": "UP"}]
    ctx = _evaluation_contexts(rows, prior, set())[day]
    assert ctx["market_context"] is None
    assert not ctx["confirmed_week_end"] and not ctx["confirmed_month_end"]
    closed = {date(2026, 9, 30), date(2026, 10, 1), date(2026, 10, 2)}
    ctx = _evaluation_contexts(rows, [{"trading_date": day, "vnindex_trend_state": "UP"}], closed)[day]
    assert ctx["confirmed_week_end"] and ctx["confirmed_month_end"]
    assert ctx["market_context"]["trading_date"] == day

def test_worker_refuses_to_execute_a_different_pinned_algorithm(monkeypatch):
    updates, replacements = [], []
    class Client:
        def queued_backtests(self, _limit): return [{**request(), "algorithm_version": "core-rules-v3.0.0"}]
        def price_history(self, *_args):
            return [{"trading_date": "2026-01-0" + str(i), "open": 20, "high": 21, "low": 19, "close": 20, "volume": 1000} for i in range(1, 4)]
        def update_backtest(self, run_id, payload, lease=None): updates.append(payload)
        def replace_backtest_trades(self, *args): replacements.append(args)
        def close(self): pass
    monkeypatch.setattr("protstock.backtest_worker.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.backtest_worker.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.backtest_worker.run_backtest", lambda *_args, **_kwargs: {"algorithm_version": "core-rules-v4.0.0"})
    assert process_backtests() == {"succeeded": 0, "failed": 1}
    assert updates[-1]["status"] == "FAILED"
    assert "Phiên bản tính toán đã thay đổi" in updates[-1]["error_message"]
    assert not replacements

def test_worker_prefers_matched_research_and_keeps_exchange_context(monkeypatch):
    from protstock.provider_vnstock import KBS_SOURCE_VERSION, STOCK_PRICE_UNIT
    updates = []
    class Client:
        def queued_backtests(self, _limit): return [request()]
        def symbol_by_id(self, symbol_id): return {"id": symbol_id, "exchange": "HNX", "sector": "TEST"}
        def research_price_status(self, _symbol): return {"coverage_status": "MATCHED", "source_version": KBS_SOURCE_VERSION, "requested_start_date": "2026-01-01", "requested_end_date": "2026-01-03"}
        def research_price_history(self, *_args):
            return [{"trading_date": "2026-01-0" + str(i), "open": 20, "high": 21, "low": 19, "close": 20,
                     "volume": 1000, "price_unit": STOCK_PRICE_UNIT, "source_version": KBS_SOURCE_VERSION, "quality_status": "VALID"} for i in range(1, 4)]
        def price_history(self, *_args): raise AssertionError("Matched coherent research must not use legacy stored prices")
        def closed_trading_sessions(self, exchange, *_args):
            assert exchange == "HNX"
            return set()
        def update_backtest(self, run_id, payload, lease=None): updates.append(payload)
        def replace_backtest_trades(self, *_args): pass
        def close(self): pass
    def simulate(rows, rule, assumptions, **kwargs):
        assert rows[0]["date"] == "2026-01-01"
        context = kwargs["evaluation_contexts"]["2026-01-03"]
        assert context["symbol_id"] == 7 and context["exchange"] == "HNX" and context["sector"] == "TEST"
        return {"trades": [], "metrics": {"total_return": 0}, "warnings": [], "evaluation_summary": {},
                "execution_model": "CLOSE_SIGNAL_NEXT_OPEN", "price_unit": "VND", "source_price_unit": "THOUSAND_VND",
                "benchmark_metrics": {}, "equity_curve": [], "algorithm_version": "core-rules-v4.0.0", "data_revision": "research-hash"}
    monkeypatch.setattr("protstock.backtest_worker.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.backtest_worker.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.backtest_worker.run_backtest", simulate)
    assert process_backtests() == {"succeeded": 1, "failed": 0}
    assert updates[-1]["metrics"]["price_basis"] == "KBS_VENDOR_REBASED"

def test_shorter_research_sync_does_not_truncate_requested_backtest(monkeypatch):
    from protstock.provider_vnstock import KBS_SOURCE_VERSION
    updates, stored_calls = [], []
    class Client:
        def queued_backtests(self, _limit): return [request()]
        def research_price_status(self, _symbol):
            return {"coverage_status": "MATCHED", "source_version": KBS_SOURCE_VERSION,
                    "requested_start_date": "2026-01-01", "requested_end_date": "2026-01-02"}
        def research_price_history(self, *_args): raise AssertionError("Research does not cover the requested end")
        def price_history(self, *_args):
            stored_calls.append(True)
            return [{"trading_date": "2026-01-0" + str(i), "open": 20, "high": 21, "low": 19, "close": 20, "volume": 1000} for i in range(1, 4)]
        def update_backtest(self, run_id, payload, lease=None): updates.append(payload)
        def replace_backtest_trades(self, *_args): pass
        def close(self): pass
    monkeypatch.setattr("protstock.backtest_worker.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.backtest_worker.Settings.from_env", lambda: object())
    assert process_backtests() == {"succeeded": 1, "failed": 0}
    assert stored_calls == [True]
    assert updates[-1]["metrics"]["price_basis"] == "STORED_VERIFIED"
    assert updates[-1]["metrics"]["evaluation_period"]["last_date"] == "2026-01-03"
