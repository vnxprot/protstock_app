from datetime import date, timedelta

import pytest

from protstock.analysis import _apply_zone_confluence, resolve_signal
from protstock.eod import _write_analysis
from protstock.market_regime import compute_breadth, regime_ok
from protstock.outcomes import evaluate_signal_outcome
from protstock.zones import zone_confluence_bonus


def _snapshot(close: float = 100) -> dict:
    return {"close": close, "trend_state": "UP", "volume_ratio20": 2, "volume_avg20": 5_000_000, "rsi14": 50, "atr14": 2}


def _bull(score: float = 75) -> dict:
    return {"pattern_type": "DOUBLE_BOTTOM", "direction": "BULLISH", "state": "CONFIRMED", "quality_score": score, "start_date": "2026-09-01", "trigger_price": 100, "invalidation_price": 95, "reasons": [], "evidence": {}}


def _bad_market() -> dict:
    return {"breadth": {"pct_above_sma50": 25, "sample_size": 100}, "vnindex_snapshot": {"trend_state": "DOWN"}}


def test_breadth_and_regime_report_both_weak_reasons() -> None:
    breadth = compute_breadth([{"close": 90, "sma50": 100}, {"close": 110, "sma50": 100}, {"close": 10, "sma50": None}])
    assert breadth == {"pct_above_sma50": 50.0, "sample_size": 2}
    assert regime_ok({"pct_above_sma50": 25}, {"trend_state": "DOWN"}) == (False, ["MARKET_BREADTH_WEAK", "VNINDEX_DOWNTREND"])


def test_bad_market_downgrades_long_but_never_exit() -> None:
    action, reasons = resolve_signal([_bull()], _snapshot(), market_context=_bad_market())
    assert action == "WATCH"
    assert {"MARKET_BREADTH_WEAK", "VNINDEX_DOWNTREND"} <= set(reasons)
    assert resolve_signal([_bull()], _snapshot(90), {"invalidation_price": 95}, market_context=_bad_market()) == ("EXIT", ["INVALIDATION_BROKEN"])


class _RecordingClient:
    def __init__(self) -> None:
        self.deleted: list[tuple[int, str, str]] = []

    def upsert(self, _table, rows, _conflict):
        return len(list(rows))

    def delete_consolidated_signal(self, symbol_id, timeframe, as_of_date):
        self.deleted.append((symbol_id, timeframe, as_of_date))


def test_no_enabled_engine_clears_stale_consolidated_storage() -> None:
    action, reasons = resolve_signal([_bull()], _snapshot(), market_context=_bad_market())
    client = _RecordingClient()
    _write_analysis(client, 7, "D", [{"date": "2026-09-10"}], [], [], {"snapshots": 0, "patterns": 0, "zones": 0, "signals": 0}, {
        "as_of_date": "2026-09-10", "indicators": _snapshot(), "patterns": [], "zones": [], "signal_preview": action, "reasons": reasons,
    }, {})
    assert client.deleted == [(7, "D", "2026-09-10")]


def test_zone_confluence_increases_quality_and_caps_bonus() -> None:
    zone = {"zone_type": "RESISTANCE", "lower_price": 99, "upper_price": 101, "strength": 999}
    bonus, reason = zone_confluence_bonus(100, "BULLISH", [zone])
    assert (bonus, reason) == (8.0, "ZONE_CONFLUENCE")
    enriched = _apply_zone_confluence([_bull(65)], [zone])[0]
    assert enriched["quality_score"] == 73.0
    assert "ZONE_CONFLUENCE" in enriched["reasons"]
    assert _apply_zone_confluence([_bull(65)], [])[0]["quality_score"] == 65


def _history(closes: list[tuple[float, float]]) -> list[dict]:
    start = date(2026, 1, 1)
    return [{"trading_date": (start + timedelta(days=index)).isoformat(), "close": close, "low": low} for index, (close, low) in enumerate(closes)]


def test_signal_outcome_handles_breach_and_no_breach() -> None:
    signal = {"id": "signal-1", "as_of_date": "2026-01-01", "evidence": {"invalidation_price": 95}}
    breached = evaluate_signal_outcome(signal, _history([(100, 100), (104, 104), (94, 94), (110, 110)]), 3)
    assert breached == {"signal_id": "signal-1", "horizon_days": 3, "forward_return_pct": pytest.approx(0.1), "max_drawdown_pct": pytest.approx(-0.09615384615384615), "hit_invalidation": True}
    safe = evaluate_signal_outcome(signal, _history([(100, 100), (105, 105), (102, 102), (110, 110)]), 3)
    assert safe["hit_invalidation"] is False
    assert safe["max_drawdown_pct"] == pytest.approx(-0.02857142857142858)
