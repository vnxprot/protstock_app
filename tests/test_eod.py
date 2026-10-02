from datetime import date, timedelta
from types import SimpleNamespace

from protstock.eod import FAST_LANE_BENCHMARK_FETCH_DAYS, _benchmark_snapshot, _confirmed_week_end, _fetch_history_with_retry, _load_portfolios, _rows_as_of, finalize_fast_lane, resolve_eod_session, run_eod


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


def test_timeout_retries_same_honest_provider(monkeypatch) -> None:
    monkeypatch.setattr("protstock.eod.sleep", lambda _: None)
    class Provider:
        calls = 0
        def history(self, *_args):
            self.calls += 1
            if self.calls < 3:
                raise TimeoutError("temporary upstream timeout")
            return ["ok"]
    provider = Provider()
    assert _fetch_history_with_retry(provider, "FPT", date(2026, 1, 1), date(2026, 1, 2)) == ["ok"]
    assert provider.calls == 3


def test_prepared_analysis_rejects_other_session_or_revision(tmp_path) -> None:
    import gzip
    import json
    import pytest
    from protstock.eod import load_prepared_analyses
    from protstock.analysis import ALGORITHM_VERSION
    day = date(2026, 10, 2)
    def save(payload):
        with gzip.open(tmp_path / "handoff.json.gz", "wt", encoding="utf-8") as f:
            json.dump(payload, f)
    item = [1, "D", [{"date": day.isoformat()}], {}, {"as_of_date": day.isoformat()}, {"data_date": day.isoformat()}]
    save({"trading_date": day.isoformat(), "source_revision": ALGORITHM_VERSION, "analyses": [item]})
    assert load_prepared_analyses(tmp_path, day) == {1: [item]}
    save({"trading_date": "2026-10-01", "source_revision": ALGORITHM_VERSION, "analyses": [item]})
    with pytest.raises(ValueError, match="session or algorithm"):
        load_prepared_analyses(tmp_path, day)
    save({"trading_date": day.isoformat(), "source_revision": "old-engine", "analyses": [item]})
    with pytest.raises(ValueError, match="session or algorithm"):
        load_prepared_analyses(tmp_path, day)


def test_prepared_analysis_rejects_duplicate_symbol_timeframe(tmp_path) -> None:
    import gzip
    import json
    import pytest
    from protstock.eod import load_prepared_analyses
    from protstock.analysis import ALGORITHM_VERSION
    day = date(2026, 10, 2)
    item = [1, "D", [{"date": day.isoformat()}], {}, {"as_of_date": day.isoformat()}, {"data_date": day.isoformat()}]
    with gzip.open(tmp_path / "handoff.json.gz", "wt", encoding="utf-8") as f:
        json.dump({"trading_date": day.isoformat(), "source_revision": ALGORITHM_VERSION, "analyses": [item, item]}, f)
    with pytest.raises(ValueError, match="Duplicate"):
        load_prepared_analyses(tmp_path, day)



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


def test_final_watchdog_publishes_partial_same_day_coverage(monkeypatch) -> None:
    day = date(2026, 9, 28)
    calls = []

    class Client:
        def active_symbols(self): return [{"id": 1, "symbol": "AAA"}, {"id": 2, "symbol": "BBB"}]
        def daily_snapshots_for_date(self, _day): return [{"symbol_id": 1}]
        def market_index(self, _code): return {"id": 1}
        def index_price_history(self, *_args): return [{"trading_date": day.isoformat()}]
        def close(self): pass

    def persist(_client, _day, trend):
        calls.append(("breadth", _day, trend))
        return {"coverage_status": "DEGRADED", "observed_count": 1, "eligible_count": 2}

    def rebuild(_day, **kwargs):
        calls.append(("signals", _day, kwargs["prepared_market_context"]["trading_date"]))
        return {"status": "SUCCEEDED", "signals": 2, "published_signals": 2}

    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.eod._benchmark_snapshot", lambda *_args: {"trend_state": "SIDEWAYS"})
    monkeypatch.setattr("protstock.eod._persist_universe_breadth", persist)
    monkeypatch.setattr("protstock.eod.rebuild_signals", rebuild)

    result = finalize_fast_lane(day, allow_partial=True)
    assert result["status"] == "PARTIAL"
    assert result["covered"] == 1 and result["expected"] == 2
    assert result["missing_symbols"] == ["BBB"]
    assert result["published_signals"] == 2
    assert calls == [("breadth", day, "SIDEWAYS"), ("signals", day, day.isoformat())]


def test_final_watchdog_rejects_zero_same_day_snapshots(monkeypatch) -> None:
    class Client:
        def active_symbols(self): return [{"id": 1, "symbol": "AAA"}]
        def daily_snapshots_for_date(self, _day): return []
        def close(self): pass

    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    try:
        finalize_fast_lane(date(2026, 9, 28), allow_partial=True)
    except RuntimeError as exc:
        assert "No same-day snapshots" in str(exc)
    else:
        raise AssertionError("zero coverage cannot produce a meaningful market context")


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
        def consolidated_signal_count(self, *_args): return 0
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
    monkeypatch.setattr("protstock.eod.build_fibonacci_context", lambda *_args: {})
    monkeypatch.setattr("protstock.eod.classify_wyckoff_timeframe", lambda *_args, **_kwargs: {})
    monkeypatch.setattr("protstock.eod._decision_context", lambda *_args: {"period_events": {}, "data_date": day.isoformat(), "evaluation_date": day.isoformat(), "daily_snapshot": {}})
    monkeypatch.setattr("protstock.eod._benchmark_snapshot", lambda *_args: {"trend_state": "SIDEWAYS"})
    monkeypatch.setattr("protstock.eod._persist_universe_breadth", breadth)
    monkeypatch.setattr("protstock.eod._write_analysis", write)
    monkeypatch.setattr("protstock.eod.sleep", lambda _seconds: None)

    assert run_eod(day, pause_seconds=0)["status"] == "SUCCEEDED"
    assert events == ["snapshot", "breadth", "signal"]


def test_weekend_rerun_uses_friday_and_recorded_holiday_uses_previous_session() -> None:
    class Client:
        def closed_trading_sessions(self, _exchange, _start, _end): return self.closed
        def market_index(self, _code): return {"id": 1}
        def index_price_dates(self, _index_id, _start, _end): return ["2026-09-24"]

    client = Client()
    client.closed = set()
    assert resolve_eod_session(client, date(2026, 9, 27)) == date(2026, 9, 25)
    client.closed = {date(2026, 9, 25)}
    assert resolve_eod_session(client, date(2026, 9, 27)) == date(2026, 9, 24)
    assert resolve_eod_session(client, date(2026, 9, 25)) == date(2026, 9, 24)


def test_week_closes_only_on_confirmed_last_session() -> None:
    class Client:
        def __init__(self, closed): self.closed = closed
        def closed_trading_sessions(self, _exchange, _start, _end): return self.closed

    friday = date(2026, 9, 25)
    thursday = date(2026, 9, 24)
    assert _confirmed_week_end(Client(set()), friday, [{"date": friday.isoformat()}]) == friday
    assert _confirmed_week_end(Client(set()), thursday, [{"date": thursday.isoformat()}]) is None
    assert _confirmed_week_end(Client({friday}), thursday, [{"date": thursday.isoformat()}]) == thursday
    assert _confirmed_week_end(Client(set()), friday, [{"date": thursday.isoformat()}]) is None


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

def _rebuild_same_session_fixture(monkeypatch, day, prepared, stale_cached=False, fresh_cached=False):
    from protstock.eod import rebuild_signals
    previous = day - timedelta(days=1)
    future = day + timedelta(days=7)
    def bar(on):
        return {"trading_date": on.isoformat(), "open": 10, "high": 11, "low": 9, "close": 10, "volume": 100}
    writes, deleted, items, finished = [], [], [], []
    class Client:
        def create_job(self, _payload): return {"id": "rebuild"}
        def active_symbols(self):
            return [{"id": 1, "symbol": "FRESH", "sector": "TEST"},
                    {"id": 2, "symbol": "STALE", "sector": "TEST"},
                    {"id": 3, "symbol": "EMPTY", "sector": "TEST"}]
        def active_rule_versions(self):
            return [{"id": "version", "dsl": {"engine": "core_ladder_v2"},
                     "rules": {"id": "rule", "user_id": "owner"}}]
        def market_index(self, _code): return {"id": 1}
        def index_price_history(self, *_args): return [bar(day), bar(future)]
        def price_history(self, symbol_id, *_args):
            return {1: [bar(day), bar(future)], 2: [bar(previous), bar(future)], 3: []}[symbol_id]
        def delete_consolidated_signal(self, symbol_id, timeframe, requested): deleted.append((symbol_id, timeframe, requested))
        def create_job_item(self, payload): items.append(payload)
        def finish_job(self, _id, payload): finished.append(payload)
        def consolidated_signal_count(self, *_args): return 0
        def upsert(self, *_args): return 0
        def close(self): pass
    def write(_client, symbol_id, timeframe, rows, _index, _rules, _counts, result, context, **_options):
        writes.append((symbol_id, timeframe, rows[-1]["date"], result["as_of_date"]))
    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.eod.aggregate_bars", lambda *_args, **_kwargs: [])
    monkeypatch.setattr("protstock.eod.analyze_bars", lambda rows, **_kwargs: {"as_of_date": rows[-1]["date"], "indicators": {}, "patterns": [], "zones": []})
    monkeypatch.setattr("protstock.eod.build_fibonacci_context", lambda *_args: {})
    monkeypatch.setattr("protstock.eod.classify_wyckoff_timeframe", lambda *_args, **_kwargs: {})
    monkeypatch.setattr("protstock.eod._decision_context", lambda *_args: {"period_events": {}, "data_date": day.isoformat(), "evaluation_date": day.isoformat(), "daily_snapshot": {}})
    monkeypatch.setattr("protstock.eod._benchmark_snapshot", lambda *_args: {"trend_state": "SIDEWAYS"})
    monkeypatch.setattr("protstock.eod._persist_universe_breadth", lambda *_args: {"coverage_status": "COMPLETE"})
    monkeypatch.setattr("protstock.eod._load_portfolios", lambda *_args, **_kwargs: {})
    monkeypatch.setattr("protstock.eod._write_analysis", write)
    cached_day = previous if stale_cached else day
    cached = {2: [[2, "D", [{**bar(cached_day), "date": cached_day.isoformat()}], [],
                    {"as_of_date": cached_day.isoformat()}, {"data_date": cached_day.isoformat()}]]} if stale_cached or fresh_cached else None
    context = {"trading_date": day.isoformat(), "breadth": {"coverage_status": "COMPLETE"}} if prepared else None
    result = rebuild_signals(day, historical=day < date(2026, 10, 2), prepared_market_context=context, prepared_analyses=cached)
    return result, writes, deleted, items, finished


def test_full_rebuild_counts_only_prices_on_requested_session(monkeypatch):
    result, writes, deleted, items, finished = _rebuild_same_session_fixture(monkeypatch, date(2026, 10, 2), False)
    assert result["covered_symbols"] == result["symbols"] == 1
    assert result["expected_symbols"] == 3 and result["skipped_missing_price"] == 2
    assert result["failed"] == 0 and result["status"] == "SUCCEEDED"
    assert result["publication_status"] == "PARTIAL"
    assert {item[0] for item in writes} == {1}
    assert all(item[2] == item[3] == "2026-10-02" for item in writes)
    assert {(symbol_id, frame) for symbol_id, frame, _day in deleted} == {(symbol_id, frame) for symbol_id in (2, 3) for frame in ("D", "W", "M")}
    assert [item["status"] for item in items] == ["SUCCEEDED", "SKIPPED", "SKIPPED"]
    assert finished[-1]["counts"]["covered_symbols"] == 1


def test_historical_rebuild_requires_exact_historical_session_not_latest_price(monkeypatch):
    requested = date(2026, 9, 25)
    result, writes, deleted, _items, _finished = _rebuild_same_session_fixture(monkeypatch, requested, False)
    assert result["covered_symbols"] == 1 and result["skipped_missing_price"] == 2
    assert {item[0] for item in writes} == {1}
    assert all(item[2] == item[3] == requested.isoformat() for item in writes)
    assert all(item[2] == requested.isoformat() for item in deleted)


def test_prepared_rebuild_does_not_reuse_stale_cached_daily_analysis(monkeypatch):
    result, writes, _deleted, _items, _finished = _rebuild_same_session_fixture(monkeypatch, date(2026, 10, 2), True, stale_cached=True)
    assert result["covered_symbols"] == 1 and result["skipped_missing_price"] == 2
    assert result.get("analysis_reused", 0) == 0
    assert {item[0] for item in writes} == {1}

def test_prepared_rebuild_keeps_same_session_cached_analysis_reuse(monkeypatch):
    result, writes, _deleted, _items, _finished = _rebuild_same_session_fixture(monkeypatch, date(2026, 10, 2), True, fresh_cached=True)
    assert result["analysis_reused"] == 1 and result["covered_symbols"] == 2
    assert result["skipped_missing_price"] == 1 and result["publication_status"] == "PARTIAL"
    assert {item[0] for item in writes} == {1, 2}
    assert all(item[2] == item[3] == "2026-10-02" for item in writes)
