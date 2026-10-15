from datetime import date, timedelta

from protstock.engines import (
    CORE_PACK_METADATA,
    evaluate_pullback_continuation_v1,
    evaluate_relative_strength_leader_v1,
    evaluate_rsi_macd_divergence_v1,
    evaluate_vcp_breakout_v1,
)


def _bar(index: int, close: float = 100, volume: float = 100, *, high: float | None = None, low: float | None = None, open_: float | None = None) -> dict:
    return {"date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(), "open": open_ if open_ is not None else close - .5, "high": high if high is not None else close + 1, "low": low if low is not None else close - 1, "close": close, "volume": volume}


def test_pullback_continuation_pack_requires_mtf_touch_low_volume_and_reversal() -> None:
    bars = [_bar(0, 100, 80, high=101, low=99, open_=99.5)]
    context = {"bars": bars, "snapshot": {"ema20": 100, "sma50": 96, "volume_ratio20": .8}, "multi_timeframe_context": {"monthly_snapshot": {"trend_state": "UP"}, "weekly_snapshot": {"trend_state": "UP"}}}
    assert evaluate_pullback_continuation_v1(context)[0:2] == (True, "PROBE_BUY")


def _vcp_bars() -> list[dict]:
    bars = [_bar(i, 50 + i * .28, 100_000, high=51 + i * .28, low=49 + i * .28) for i in range(180)]
    bars.extend(_bar(i, 101, 100_000, high=105, low=99) for i in range(180, 219))
    for index in range(201, 219):
        bars[index] = _bar(index, 105, 100_000, high=106, low=103)
    for index, high, low, close in ((180, 110, 103, 106), (185, 100, 85, 94),
                                    (195, 108, 101, 105), (200, 100, 94, 98),
                                    (209, 107, 102, 105), (214, 104, 100, 102)):
        bars[index] = _bar(index, close, 100_000, high=high, low=low)
    for index in range(215, 219):
        bars[index] = _bar(index, 105, 50_000, high=106, low=103)
    bars.append(_bar(219, 108, 150_000, high=109, low=104))
    return bars


def test_vcp_breakout_pack_detects_swing_contractions_and_pivot() -> None:
    context = {"bars": _vcp_bars(), "timeframe": "D", "candidate_exchange": "HOSE"}
    assert evaluate_vcp_breakout_v1(context)[0:2] == (True, "PROBE_BUY")
    assert context["engine_evidence"]["pivot"] == 107
    assert len(context["engine_evidence"]["contraction_depths"]) == 3


def test_vcp_dry_up_needs_two_individual_sessions_even_after_volume_spike() -> None:
    bars = _vcp_bars()
    for index in range(215, 219):
        bars[index]["volume"] = 100_000
    assert evaluate_vcp_breakout_v1({"bars": bars, "timeframe": "D"})[0:2] == (False, "WATCH")


def test_rsi_macd_divergence_pack_does_not_use_current_rsi_for_unconfirmed_pivot() -> None:
    closes = [120 - index * 2 for index in range(15)] + [92, 95, 98, 100, 98, 96, 94, 92, 89]
    bars = [_bar(index, close, 100, high=close + 1, low=close - 1) for index, close in enumerate(closes)]
    context = {"bars": bars, "snapshot": {"rsi14": 35}, "zones": [{"zone_type": "SUPPORT", "strength": 70, "lower_price": 85, "upper_price": 90}]}
    assert evaluate_rsi_macd_divergence_v1(context)[0:2] == (False, "WATCH")


def test_relative_strength_leader_pack_requires_strength_in_soft_market() -> None:
    context = {"snapshot": {"relative_strength_market": .08, "trend_state": "UP"}, "market_context": {"vnindex_snapshot": {"trend_state": "SIDEWAYS"}}}
    emitted, action, reasons = evaluate_relative_strength_leader_v1(context)
    assert (emitted, action) == (False, "WATCH")
    assert reasons == ["RELATIVE_STRENGTH_GT_5PCT", "VNINDEX_SIDEWAYS", "STOCK_UPTREND"]


def test_core_pack_metadata_describes_all_phase_two_packs() -> None:
    assert set(CORE_PACK_METADATA) == {"pullback_continuation_v1", "vcp_breakout_v1", "rsi_macd_divergence_v1", "macd_bullish_divergence_v3", "macd_bullish_divergence_v4", "relative_strength_leader_v1", "wyckoff_context_v1", "tplus_pullback_v1"}
