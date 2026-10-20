from datetime import date, timedelta

from protstock.investment_modules import assess_prices, cycle_assessment, rank_strength


def prices(count=300):
    start = date(2024, 1, 1)
    days = [start + timedelta(days=i) for i in range(500) if (start + timedelta(days=i)).weekday() < 5][:count]
    return [{"date": str(day), "close": 10 + i * .02, "open": 10 + i * .02,
             "high": 10.2 + i * .02, "low": 9.8 + i * .02, "volume": 100000,
             "source": "VCI_DIRECT", "data_revision": "canonical", "price_basis": "VENDOR_CORPORATE_ACTION_ADJUSTED"}
            for i, day in enumerate(days)]


def test_incomplete_week_never_changes_primary_cycle():
    rows = prices()
    from protstock.timeframes import aggregate_bars
    weeks = aggregate_bars(rows, "W")
    before = cycle_assessment(weeks, rows)
    weeks[-1] = {**weeks[-1], "close": .1, "low": .1, "volume": 1000000000}
    after = cycle_assessment(weeks, rows)
    assert before == after


def test_volume_baseline_excludes_breakout_session():
    rows = prices()
    rows[-1] = {**rows[-1], "volume": 200000}
    result = assess_prices(rows, rows, None)
    assert result["volume_ratio50"] == 2
    assert result["rs12m_excess"] == 0


def test_missing_sessions_do_not_create_a_comparable_12_month_rank():
    benchmark = prices(310)
    rows = [row for index, row in enumerate(benchmark) if index != 100]
    assert assess_prices(rows, benchmark, None)["rs12m"] is None


def test_equal_returns_receive_equal_ranks_and_small_samples_are_unknown():
    rows = [{"symbol_id": i, "evidence": {"quality": "VALID", "rs12m": 20}} for i in range(20)]
    rank_strength(rows)
    assert {item["evidence"]["rs_percentile"] for item in rows} == {50}
    rank_strength(rows[:19])
    assert all(item["evidence"]["rs_percentile"] is None for item in rows[:19])


def test_insufficient_history_is_unknown_not_accumulation():
    result = assess_prices(prices(30), prices(), None)
    assert result["quality"] == "INSUFFICIENT"
    assert result["cycle"]["state"] == "UNKNOWN"
    assert result["cycle"]["candidate"] == "UNKNOWN"
