from datetime import date

from protstock.decision_context import opposing_structures, reconcile_proposal
from protstock.engines import evaluate_classical_patterns_v0
from protstock.eod import _confirmed_month_end
from protstock.resolution import classify_signal_state
from protstock.timeframes import aggregate_bars


def _bar(day: str) -> dict:
    return {"date": day, "open": 10, "high": 11, "low": 9, "close": 10, "volume": 100}


def test_month_requires_verified_final_session() -> None:
    class Client:
        def __init__(self, closed: set[date]):
            self.closed = closed

        def closed_trading_sessions(self, _exchange, _start, _end):
            return self.closed

    final = date(2026, 9, 30)
    prior = date(2026, 9, 29)
    assert _confirmed_month_end(Client(set()), final, [_bar(final.isoformat())]) == final
    assert _confirmed_month_end(Client(set()), prior, [_bar(prior.isoformat())]) is None
    assert _confirmed_month_end(Client({final}), prior, [_bar(prior.isoformat())]) == prior
    assert _confirmed_month_end(Client(set()), final, [_bar(prior.isoformat())]) is None
    assert not aggregate_bars([_bar(prior.isoformat())], "M")[-1]["is_complete"]
    assert aggregate_bars([_bar(prior.isoformat())], "M", confirmed_month_end=prior)[-1]["is_complete"]


def test_ready_bear_warns_but_confirmed_bear_blocks_new_entry() -> None:
    ready = {"direction": "BEARISH", "state": "READY", "quality_score": 90}
    confirmed = {"direction": "BEARISH", "state": "CONFIRMED", "quality_score": 75}
    assert opposing_structures([ready, confirmed])["BEARISH"][0] is confirmed
    assert reconcile_proposal("PROBE_BUY", [], timeframe="D", patterns=[ready]) == (
        "PROBE_BUY", ["OPPOSING_BEARISH_READY"]
    )
    assert reconcile_proposal("PROBE_BUY", [], timeframe="D", patterns=[], weekly_patterns=[confirmed]) == (
        "WATCH", ["ENTRY_BLOCKED", "OPPOSING_BEARISH_CONFIRMED"]
    )
    assert reconcile_proposal("EXIT", [], timeframe="D", patterns=[confirmed]) == ("EXIT", [])
    assert classify_signal_state("WATCH", ["ENTRY_BLOCKED", "OPPOSING_BEARISH_CONFIRMED"]) != "ACTIONABLE"


def test_weekly_flat_base_is_setup_not_buy_order() -> None:
    candidate = {
        "model": "flat_base", "pattern_type": "FLAT_BASE_BREAKOUT", "state": "READY",
        "direction": "BULLISH", "quality_score": 75, "trigger_price": 12,
        "invalidation_price": 10, "evidence": {}, "reasons": ["TIGHT_FLAT_BASE"],
    }
    weekly = {"timeframe": "W", "classical_patterns": [candidate], "bars": [], "snapshot": {}, "zones": []}
    passed, action, reasons = evaluate_classical_patterns_v0(weekly)
    assert passed and action == "WATCH" and "V0_NEAR_FLAT_BASE_BREAKOUT" in reasons
    daily = {**weekly, "timeframe": "D"}
    assert evaluate_classical_patterns_v0(daily) == (False, "WATCH", [])
