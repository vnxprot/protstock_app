from datetime import date, timedelta
from types import SimpleNamespace

from protstock.eod import FAST_LANE_BENCHMARK_FETCH_DAYS, _benchmark_snapshot, _fetch_history_with_fallback, _fetch_history_with_retry, _load_portfolios, _rows_as_of, finalize_fast_lane, run_eod


class RateLimitedProvider:
    def __init__(self) -> None:
        self.calls = 0

    def history(self, *_args):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("Rate limit exceeded")
        return ["ok"]


def test_rate_limit_is_retried(monkeypatch) -> None:
    monkeypatch.setattr("protstock.eod.sleep", lambda _: None)
    provider = RateLimitedProvider()
    assert _fetch_history_with_retry(provider, "FPT", date(2026, 1, 1), date(2026, 1, 2)) == ["ok"]
    assert provider.calls == 2


def test_symbol_fetch_falls_back_to_alternate_source_after_timeout() -> None:
    class TimedOutProvider:
        def history(self, *_args):
            raise TimeoutError("Read timed out")

    class WorkingProvider:
        def __init__(self) -> None:
            self.calls = 0

        def history(self, *_args):
            self.calls += 1
            return ["fallback-bar"]

    fallback = WorkingProvider()
    bars, used_fallback = _fetch_history_with_fallback(
        TimedOutProvider(), fallback, "TAR", date(2026, 9, 11), date(2026, 9, 11)
    )
    assert (bars, used_fallback, fallback.calls) == (["fallback-bar"], True, 1)


def test_rows_as_of_excludes_future_bars() -> None:
    rows = [
        {"trading_date": "2026-09-08", "close": 10},
        {"trading_date": "2026-09-09", "close": 11},
        {"trading_date": "2026-09-10", "close": 12},
    ]
    assert _rows_as_of(rows, date(2026, 9, 9)) == rows[:2]


def test_benchmark_fetch_uses_independent_lookback(monkeypatch) -> None:
    calls = []

    class Client:
        def create_job(self, _payload): return {"id": "job"}
        def active_symbols(self): return []
        def active_rule_versions(self): return []
        def market_index(self, _code): return {"id": 1}
        def upsert(self, *_args): return 0
        def index_price_history(self, *_args): return []
        def finish_job(self, *_args): pass
        def close(self): pass

    class Provider:
        def history(self, symbol, start, end):
            calls.append((symbol, start, end))
            return []

    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.eod.VnstockProvider", lambda _source: Provider())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    run_eod(date(2026, 9, 10), lookback_days=10, benchmark_lookback_days=9_999, pause_seconds=0)
    assert calls == [("VNINDEX", date(2026, 9, 10) - timedelta(days=9_999), date(2026, 9, 10))]


def test_fast_lane_fetches_only_incremental_benchmark_when_cache_is_ready(monkeypatch) -> None:
    calls = []

    class Client:
        def create_job(self, _payload): return {"id": "job"}
        def active_symbols(self): return []
        def active_rule_versions(self): return []
        def market_index(self, _code): return {"id": 1}
        def upsert(self, *_args): return 0
        def index_price_history(self, *_args): return [{"trading_date": "2026-01-01", "close": 1}] * 260
        def finish_job(self, *_args): pass
        def close(self): pass

    class Provider:
        def history(self, symbol, start, end):
            calls.append((symbol, start, end))
            return []

    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.eod.VnstockProvider", lambda _source: Provider())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    run_eod(date(2026, 9, 10), fast_lane=True, pause_seconds=0)
    assert calls == [("VNINDEX", date(2026, 9, 10) - timedelta(days=FAST_LANE_BENCHMARK_FETCH_DAYS), date(2026, 9, 10))]


def test_finalize_fast_lane_requires_all_active_symbols(monkeypatch) -> None:
    class Client:
        def active_symbols(self): return [{"id": 1}, {"id": 2}]
        def daily_snapshots_for_date(self, _date): return [{"symbol_id": 1, "close": 10, "sma50": 9}]
        def close(self): pass

    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    try:
        finalize_fast_lane(date(2026, 9, 10))
    except RuntimeError as exc:
        assert "1/2" in str(exc)
    else:
        raise AssertionError("incomplete Fast Lane must not finalize")


def test_eod_evaluates_signals_only_after_same_day_market_snapshot(monkeypatch) -> None:
    day = date(2026, 9, 25)
    events = []
    row = {"trading_date": day.isoformat(), "open": 10, "high": 11, "low": 9, "close": 10, "volume": 100}

    class Client:
        def create_job(self, _payload): return {"id": "job"}
        def active_symbols(self): return [{"id": 1, "symbol": "AAA", "sector": "Test"}]
        def active_rule_versions(self): return []
        def market_index(self, _code): return {"id": 1}
        def index_price_history(self, *_args): return [row]
        def price_history(self, *_args): return [row]
        def upsert(self, *_args): return 1
        def create_job_item(self, _payload): pass
        def finish_job(self, *_args): pass
        def close(self): pass

    class Provider:
        def history(self, *_args):
            return [SimpleNamespace(trading_date=day, collected_at=day, source="KBS", **{key: row[key] for key in ("open", "high", "low", "close", "volume")})]

    def write(_client, _symbol_id, _timeframe, _rows, _index_rows, _rules, _counts, _result, context, **options):
        if options.get("evaluate_signals") is False:
            events.append("snapshot")
        else:
            events.append("signal")
            assert context["market_context"]["trading_date"] == day.isoformat()
            assert context["market_context"]["vnindex_snapshot"]["trend_state"] == "SIDEWAYS"

    def breadth(_client, _day, _trend):
        events.append("breadth")
        return {"coverage_status": "COMPLETE", "observed_count": 1, "eligible_count": 1}

    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.eod.VnstockProvider", lambda _source: Provider())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.eod.aggregate_bars", lambda *_args: [])
    monkeypatch.setattr("protstock.eod.analyze_bars", lambda rows, **_kwargs: {"as_of_date": rows[-1]["date"], "indicators": {}, "patterns": [], "zones": []})
    monkeypatch.setattr("protstock.eod.build_fibonacci_context", lambda _rows: {})
    monkeypatch.setattr("protstock.eod.classify_wyckoff", lambda _rows: {})
    monkeypatch.setattr("protstock.eod._decision_context", lambda *_args: {"period_events": {}, "data_date": day.isoformat(), "evaluation_date": day.isoformat(), "daily_snapshot": {}})
    monkeypatch.setattr("protstock.eod._benchmark_snapshot", lambda *_args: {"trend_state": "SIDEWAYS"})
    monkeypatch.setattr("protstock.eod._persist_universe_breadth", breadth)
    monkeypatch.setattr("protstock.eod._write_analysis", write)
    monkeypatch.setattr("protstock.eod.sleep", lambda _seconds: None)

    assert run_eod(day, pause_seconds=0)["status"] == "SUCCEEDED"
    assert events == ["snapshot", "breadth", "signal"]


def test_stale_index_bar_cannot_supply_same_day_trend() -> None:
    assert _benchmark_snapshot([{"trading_date": "2026-09-24", "close": 100}], date(2026, 9, 25)) == {"trend_state": "UNKNOWN"}


def test_current_portfolio_is_available_for_latest_session_after_weekend() -> None:
    position = {"symbol_id": 1, "quantity": 100, "average_cost": 10_000, "opened_at": "2026-09-01", "symbols": {"sector": "Bank"}}

    class Client:
        def portfolio_context(self, _owner): return {"capital": 10_000_000, "positions": [position.copy()]}
        def price_history(self, *_args): return [{"trading_date": "2026-09-25", "close": 12}]

    versions = [{"rules": {"user_id": "owner"}}]
    live = _load_portfolios(Client(), versions, date(2026, 9, 25))
    assert live["owner"]["positions"] and "error" not in live["owner"]
    historical = _load_portfolios(Client(), versions, date(2026, 9, 25), historical=True)
    assert historical["owner"]["error"] == "HISTORICAL_PORTFOLIO_UNAVAILABLE"
    assert historical["owner"]["positions"] == []


def test_fast_lane_finalization_passes_same_day_context_to_signal_rebuild(monkeypatch) -> None:
    day = date(2026, 9, 25)
    calls = []

    class Client:
        def active_symbols(self): return [{"id": 1}]
        def daily_snapshots_for_date(self, _day): return [{"symbol_id": 1}]
        def market_index(self, _code): return {"id": 1}
        def index_price_history(self, *_args): return [{"trading_date": day.isoformat()}]
        def close(self): pass

    def persist(_client, _day, trend):
        calls.append(("breadth", trend))
        return {"coverage_status": "COMPLETE"}

    def rebuild(_day, **kwargs):
        calls.append(("signals", kwargs["prepared_market_context"]["trading_date"]))
        return {"status": "SUCCEEDED", "signals": 3}

    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.eod._benchmark_snapshot", lambda *_args: {"trend_state": "SIDEWAYS"})
    monkeypatch.setattr("protstock.eod._persist_universe_breadth", persist)
    monkeypatch.setattr("protstock.eod.rebuild_signals", rebuild)
    assert finalize_fast_lane(day)["signals"] == 3
    assert calls == [("breadth", "SIDEWAYS"), ("signals", day.isoformat())]
