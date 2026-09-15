from datetime import date

from protstock.eod import _prior_market_context, _stored_universe_breadth
from protstock.market_regime import regime_ok


class Client:
    def __init__(self, rows):
        self.rows, self.written = rows, []

    def active_symbols(self):
        return [{"id": 1}, {"id": 2}]

    def daily_snapshots_for_date(self, day):
        assert day == date(2026, 9, 11)
        return self.rows

    def market_breadth_snapshot(self, day):
        assert day == date(2026, 9, 13)
        return {"trading_date": "2026-09-11", "sample_size": 1, "pct_above_sma50": 0, "vnindex_trend_state": "UP"}

    def upsert(self, table, rows, conflict):
        assert table == "market_breadth_snapshots"
        self.written.extend(rows)


def test_universe_breadth_excludes_retired_and_duplicate_rows():
    row = {"symbol_id": 1, "close": 20, "sma50": 10}
    client = Client([row, row, {"symbol_id": 2, "close": 8, "sma50": 10}, {"symbol_id": 999, "close": 100, "sma50": 10}])
    assert _stored_universe_breadth(client, date(2026, 9, 11)) == ({"pct_above_sma50": 50, "sample_size": 2}, 2)


def test_prior_breadth_repairs_single_batch_summary_from_all_stored_snapshots():
    client = Client([{"symbol_id": 1, "close": 20, "sma50": 10}, {"symbol_id": 2, "close": 8, "sma50": 10}])
    context = _prior_market_context(client, date(2026, 9, 14))
    assert context["breadth"]["pct_above_sma50"] == 50
    assert context["breadth"]["coverage_complete"] is True
    assert client.written[0]["sample_size"] == 2
    assert regime_ok(context["breadth"], context["vnindex_snapshot"]) == (True, [])


def test_missing_breadth_coverage_is_not_reported_as_weak_market():
    client = Client([{"symbol_id": 1, "close": 20, "sma50": 10}])
    context = _prior_market_context(client, date(2026, 9, 14))
    assert context["breadth"]["sample_size"] == 1
    assert context["breadth"]["expected_count"] == 2
    assert regime_ok(context["breadth"], context["vnindex_snapshot"]) == (False, ["BREADTH_COVERAGE_INCOMPLETE"])


def test_missing_sma50_is_ineligible_even_when_all_rows_exist():
    client = Client([{"symbol_id": 1, "close": 20, "sma50": 10}, {"symbol_id": 2, "close": 8, "sma50": None}])
    context = _prior_market_context(client, date(2026, 9, 14))
    assert context["breadth"]["coverage_complete"] is False
