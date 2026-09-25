from datetime import date

from protstock.eod import _prior_market_context, _stored_universe_breadth
from protstock.market_regime import build_breadth_membership, regime_ok


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
