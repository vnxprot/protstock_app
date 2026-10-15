from datetime import date
from math import sqrt

import pytest

from protstock.period_signals import monthly_trend
from protstock.signal_funnel import adaptive_monthly_context
from protstock.timeframes import aggregate_bars
from protstock.trend_context import POLICY, monthly_context, monthly_timeline, weekly_context


def months(closes):
    return [{"date": f"{2021 + i // 12}-{i % 12 + 1:02d}-28", "close": close}
            for i, close in enumerate(closes)]


def test_all_monthly_consumers_share_definition_and_minimum_history():
    for closes in ([100.0] * 23, [100 * 1.03 ** i for i in range(35)], [100 * .97 ** i for i in range(35)]):
        bars = months(closes)
        context = monthly_context(bars)
        assert adaptive_monthly_context(bars) == context
        assert monthly_trend(bars)["trend_state"] == context["state"]
    assert monthly_context(months([100.0] * 22))["state"] == "UNKNOWN"
    assert adaptive_monthly_context(months([100.0] * 6))["state"] == "UNKNOWN"


def test_flat_ties_and_tiny_drift_do_not_become_directional_trends():
    flat = monthly_context(months([100.0] * 35))
    assert flat["state"] == "SIDEWAYS"
    assert flat["above_count"] == flat["below_count"] == 0
    assert monthly_context(months([100 * (1 + .002 * i / 22) for i in range(23)]))["state"] == "SIDEWAYS"
    assert monthly_context(months([100.0] * 21 + [104.0, 108.16]))["state"] == "SIDEWAYS"


def test_regression_volatility_thresholds_and_strong_break():
    up = [100 * 1.03 ** i for i in range(35)]
    current = monthly_context(months(up))
    assert current["state"] == "UP" and current["above_count"] == 12
    assert current["entry_threshold"] == pytest.approx(max(.02, .25 * current["monthly_volatility"] * sqrt(3)))
    assert current["entry_threshold"] > current["hold_threshold"]
    broken = monthly_context(months(up + [up[-1] * .65]))
    assert broken["state"] == "SIDEWAYS"
    assert "MONTHLY_TREND_LOST" in broken["reasons"]


def test_hysteresis_holds_weaker_trend_but_cannot_hold_a_flat_market_forever():
    rising = [100 * 1.03 ** i for i in range(30)]
    timeline = monthly_timeline(months(rising + [rising[-1]] * 40))
    assert any('MONTHLY_UP_HELD' in item['reasons'] for item in timeline)
    assert timeline[-1]['state'] == 'SIDEWAYS'


def test_historical_states_do_not_depend_on_future_prices_or_invalid_future_month():
    bars = months([100 * 1.02 ** i for i in range(40)])
    timeline = monthly_timeline(bars)
    for i in (22, 27, 34):
        assert monthly_context(bars[:i + 1]) == timeline[i]
    invalid = monthly_timeline(bars + months([0]))
    assert invalid[:-1] == timeline
    assert invalid[-1]["state"] == "UNKNOWN"


def test_unclosed_candles_and_serialized_confirmations():
    bars = [{"date": "2026-09-30", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1000}]
    assert not aggregate_bars(bars, "M")[0]["is_complete"]
    assert aggregate_bars(bars, "M", confirmed_month_end="2026-09-30")[0]["is_complete"]
    assert monthly_context([{**row, "is_complete": False} for row in months([100] * 30)])["state"] == "UNKNOWN"


def test_weekly_range_is_positive_evidence_and_excludes_a_falling_trend():
    flat = [{"date": "2026-09-04", "high": 101, "low": 99, "close": 100} for _ in range(30)]
    assert weekly_context(flat)["range_confirmed"]
    falling = [{"date": "2026-09-04", "high": 101 * .97 ** i, "low": 99 * .97 ** i,
                "close": 100 * .97 ** i} for i in range(30)]
    assert not weekly_context(falling)["range_confirmed"]
    assert not weekly_context(falling)["strengthening"]
