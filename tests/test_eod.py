from datetime import date, timedelta

from protstock.eod import FAST_LANE_BENCHMARK_FETCH_DAYS, _fetch_history_with_fallback, _fetch_history_with_retry, _rows_as_of, finalize_fast_lane, run_eod


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
