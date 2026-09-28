from datetime import date

from protstock.eod import _prior_market_context, _stored_universe_breadth, rebuild_market_health
from protstock.market_regime import build_breadth_membership, regime_ok
from protstock.market_health_history import _index_trends, build_market_health_history


class Client:
    def __init__(self, rows_by_date):
        self.rows_by_date, self.written = rows_by_date, []

    def active_symbols(self):
        return [{"id": 1}, {"id": 2}]

    def latest_daily_snapshot_date_before(self, day):
        return date(2026, 9, 10) if day == date(2026, 9, 11) else None

    def daily_snapshots_for_date(self, day):
        return self.rows_by_date.get(day, [])

    def market_breadth_snapshot(self, day):
        assert day == date(2026, 9, 13)
        return {"trading_date": "2026-09-11", "sample_size": 1, "pct_above_sma50": 0, "vnindex_trend_state": "UP"}

    def upsert(self, table, rows, conflict):
        self.written.append((table, rows, conflict))
        return len(rows)


def snapshots(*rows):
    return [{"symbol_id": symbol_id, "close": close, "sma50": sma50} for symbol_id, close, sma50 in rows]


def test_eligible_universe_excludes_retired_and_duplicate_rows():
    client = Client({
        date(2026, 9, 10): snapshots((1, 20, 10), (2, 8, 10)),
        date(2026, 9, 11): snapshots((1, 20, 10), (1, 20, 10), (2, 8, 10), (999, 100, 10)),
    })
    breadth, membership = _stored_universe_breadth(client, date(2026, 9, 11))
    assert breadth["pct_above_sma50"] == 50
    assert breadth["market_health_state"] == "RISK_OFF"
    assert breadth["sample_size"] == 2
    assert breadth["universe_size"] == 2
    assert breadth["eligible_count"] == 2
    assert breadth["observed_count"] == 2
    assert breadth["coverage_ratio"] == 1
    assert breadth["coverage_status"] == "COMPLETE"
    assert {row["symbol_id"] for row in membership} == {1, 2}


def test_missing_eligible_symbol_is_audited_and_blocks_only_when_coverage_is_low():
    symbols = [{"id": index} for index in range(1, 101)]
    prior = snapshots(*[(index, 20, 10) for index in range(1, 101)])
    current = snapshots(*[(index, 20, 10) for index in range(1, 94)])
    breadth, membership = build_breadth_membership(symbols, prior, current, "2026-09-11")
    assert breadth["coverage_status"] == "INCOMPLETE"
    assert breadth["coverage_ratio"] == 0.93
    assert next(row for row in membership if row["symbol_id"] == 100)["status"] == "DATA_MISSING_OR_HALTED"
    assert regime_ok(breadth, {"trend_state": "UP"}) == (False, ["BREADTH_COVERAGE_INCOMPLETE"])


def test_degraded_coverage_stays_informative_without_becoming_a_veto():
    symbols = [{"id": index} for index in range(1, 101)]
    prior = snapshots(*[(index, 20, 10) for index in range(1, 101)])
    current = snapshots(*[(index, 20, 10) for index in range(1, 98)])
    breadth, _ = build_breadth_membership(symbols, prior, current, "2026-09-11")
    assert breadth["coverage_status"] == "DEGRADED"
    assert regime_ok(breadth, {"trend_state": "UP"}) == (True, ["BREADTH_DATA_DEGRADED"])


def test_degraded_coverage_does_not_override_a_down_market():
    breadth = {"coverage_status": "DEGRADED", "pct_above_sma50": 55}
    assert regime_ok(breadth, {"trend_state": "DOWN"}) == (False, ["BREADTH_DATA_DEGRADED", "VNINDEX_DOWNTREND"])


def test_historical_market_health_uses_same_day_index_trend_without_future_bars():
    from datetime import timedelta

    index_rows = [{"trading_date": (date(2026, 1, 1) + timedelta(days=i)).isoformat(), "close": 100 + i} for i in range(55)]
    trends = _index_trends(index_rows)
    assert trends[index_rows[48]["trading_date"]] == "UNKNOWN"
    assert trends[index_rows[49]["trading_date"]] == "UP"
    trading_day = index_rows[49]["trading_date"]
    prices = [{"symbol_id": 1, "trading_date": trading_day, "close": 10, "volume": 100}]
    history = build_market_health_history([{"id": 1}], prices, date.fromisoformat(trading_day), date.fromisoformat(trading_day), index_rows=index_rows)
    assert history[0]["vnindex_trend_state"] == "UP"


def test_long_unavailable_symbol_is_not_a_permanent_breadth_veto():
    breadth, membership = build_breadth_membership(
        [{"id": 1}, {"id": 2}],
        snapshots((1, 20, 10)),
        snapshots((1, 20, 10)),
        "2026-09-11",
    )
    assert breadth["coverage_status"] == "COMPLETE"
    assert breadth["eligible_count"] == 1
    assert next(row for row in membership if row["symbol_id"] == 2)["status"] == "NOT_ELIGIBLE"


def test_prior_breadth_repairs_legacy_summary_and_persists_membership():
    client = Client({
        date(2026, 9, 10): snapshots((1, 20, 10), (2, 8, 10)),
        date(2026, 9, 11): snapshots((1, 20, 10), (2, 8, 10)),
    })
    context = _prior_market_context(client, date(2026, 9, 14))
    assert context["breadth"]["pct_above_sma50"] == 50
    assert context["breadth"]["coverage_status"] == "COMPLETE"
    assert {table for table, _, _ in client.written} == {"market_breadth_snapshots", "breadth_universe_memberships"}
    assert regime_ok(context["breadth"], context["vnindex_snapshot"]) == (True, [])



def test_breadth_depth_uses_prior_close_and_stored_eod_fields_only():
    symbols = [{"id": 1, "sector": "Ngân hàng"}, {"id": 2, "sector": "Ngân hàng"}]
    prior = snapshots((1, 10, 9), (2, 10, 9))
    current = [
        {"symbol_id": 1, "close": 11, "sma50": 9, "last_volume": 200, "close_high20": 11, "close_low20": 8},
        {"symbol_id": 2, "close": 9, "sma50": 10, "last_volume": 100, "close_high20": 12, "close_low20": 9},
    ]
    breadth, _ = build_breadth_membership(symbols, prior, current, "2026-09-11")
    assert breadth["advance_count"] == 1
    assert breadth["decline_count"] == 1
    assert breadth["advance_decline_ratio"] == 1
    assert breadth["new_high20_count"] == 1
    assert breadth["new_low20_count"] == 1
    assert breadth["up_down_volume_ratio"] == 2
    assert breadth["sector_breadth"][0]["sector"] == "Ngân hàng"


def test_sector_flow_is_separate_from_health_and_audits_missing_members():
    symbols = [{"id": 1, "sector": "NGAN HANG"}, {"id": 2, "sector": "NGAN HANG"}, {"id": 3, "sector": "NGAN HANG"}]
    current = [
        {"symbol_id": 1, "close": 11, "sma20": 10, "sma50": 9, "sma200": 8, "ma_stack": True, "flow_score": 20, "flow_state": "PURPLE"},
        {"symbol_id": 2, "close": 11, "sma20": 10, "sma50": 9, "sma200": 8, "ma_stack": True, "flow_score": -10, "flow_state": "BLUE"},
    ]
    breadth, _ = build_breadth_membership(symbols, current, current, "2026-09-28")
    sector = breadth["sector_breadth"][0]
    assert sector["market_health_score"] == 100
    assert sector["universe_count"] == 3
    assert sector["sample_size"] == 2
    assert sector["coverage_ratio"] == 0.6667
    assert sector["flow_median_score"] == 5
    assert sector["flow_positive_count"] == sector["flow_negative_count"] == 1
    assert sector["flow_strong_in_count"] == sector["flow_strong_out_count"] == 1
    assert regime_ok(breadth, {"trend_state": "UP"}) == (True, [])


def test_historical_sector_flow_has_no_future_price_leakage():
    from datetime import timedelta

    first = date(2026, 7, 1)
    prices = [{"symbol_id": 1, "trading_date": (first + timedelta(days=i)).isoformat(), "high": 105 + i, "low": 95 + i, "close": 100 + i, "volume": 100 + i} for i in range(65)]
    day = date.fromisoformat(prices[55]["trading_date"])
    symbols = [{"id": 1, "sector": "TEST"}]
    full = build_market_health_history(symbols, prices, day, day)
    truncated = build_market_health_history(symbols, prices[:56], day, day)
    assert full[0]["sector_breadth"] == truncated[0]["sector_breadth"]
    assert full[0]["sector_breadth"][0]["flow_observed_count"] == 1


def test_historical_breadth_preserves_missing_eligible_symbols():
    from datetime import timedelta

    first = date(2026, 7, 1)
    bars = [
        {"symbol_id": symbol_id, "trading_date": (first + timedelta(days=i)).isoformat(), "high": 12, "low": 8, "close": 10, "volume": 100}
        for symbol_id in (1, 2) for i in range(60 if symbol_id == 1 else 59)
    ]
    day = first + timedelta(days=59)
    result = build_market_health_history([{"id": 1, "sector": "A"}, {"id": 2, "sector": "A"}], bars, day, day)[0]
    assert result["observed_count"] == 1
    assert result["eligible_count"] == 2
    assert result["coverage_status"] == "INCOMPLETE"


def test_history_rebuild_preserves_published_eod_membership(monkeypatch):
    day = date(2026, 9, 28)
    writes = []

    class HistoryClient:
        def active_symbols(self): return [{"id": 1, "sector": "A"}]
        def all_daily_prices(self, *_args): return []
        def market_index(self, _code): return {"id": 1}
        def index_prices_in_range(self, *_args): return []
        def published_signal_dates(self, *_args): return {day}
        def daily_snapshots_for_date(self, _day): return [{"symbol_id": 1}]
        def upsert(self, table, rows, _conflict): writes.append((table, rows)); return len(rows)
        def close(self): pass

    estimate = {"trading_date": day.isoformat(), "observed_count": 1, "eligible_count": 1, "coverage_status": "COMPLETE", "vnindex_trend_state": "UP", "sector_breadth": []}
    monkeypatch.setattr("protstock.eod.SupabaseRestClient", lambda _settings: HistoryClient())
    monkeypatch.setattr("protstock.eod.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.eod.build_market_health_history", lambda *_args, **_kwargs: [estimate])
    monkeypatch.setattr("protstock.eod._persist_universe_breadth", lambda _client, _day, _trend: {"observed_count": 1, "eligible_count": 2, "coverage_status": "DEGRADED", "sector_breadth": [{"flow_observed_count": 1}]})
    result = rebuild_market_health(day, day)
    assert not writes  # No price-only estimate may overwrite a published EOD.
    assert result["latest"]["eligible_count"] == 2
    assert result["latest"]["sectors_with_flow"] == 1
