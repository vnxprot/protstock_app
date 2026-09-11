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


def test_vcp_breakout_pack_detects_contraction_dry_up_and_breakout() -> None:
    bars = []
    for index in range(10): bars.append(_bar(index, 90, 100, high=100, low=80))
    for index in range(10, 20): bars.append(_bar(index, 92, 100, high=100, low=85))
    for index in range(20, 30): bars.append(_bar(index, 95, 100 if index < 27 else 50, high=100, low=90))
    bars.append(_bar(30, 102, 200, high=103, low=100))
    assert evaluate_vcp_breakout_v1({"bars": bars, "snapshot": {"volume_ratio20": 2.0}})[0:2] == (True, "PROBE_BUY")


def test_rsi_macd_divergence_pack_detects_higher_rsi_at_new_price_low_in_support() -> None:
    closes = [120 - index * 2 for index in range(15)] + [92, 95, 98, 100, 98, 96, 94, 92, 89]
    bars = [_bar(index, close, 100, high=close + 1, low=close - 1) for index, close in enumerate(closes)]
    context = {"bars": bars, "snapshot": {"rsi14": 35}, "zones": [{"zone_type": "SUPPORT", "strength": 70, "lower_price": 85, "upper_price": 90}]}
    assert evaluate_rsi_macd_divergence_v1(context)[0:2] == (True, "PROBE_BUY")


def test_relative_strength_leader_pack_requires_strength_in_soft_market() -> None:
    context = {"snapshot": {"relative_strength_market": .08, "trend_state": "UP"}, "market_context": {"vnindex_snapshot": {"trend_state": "SIDEWAYS"}}}
    assert evaluate_relative_strength_leader_v1(context)[0:2] == (True, "PROBE_BUY")


def test_core_pack_metadata_describes_all_phase_two_packs() -> None:
    assert set(CORE_PACK_METADATA) == {"pullback_continuation_v1", "vcp_breakout_v1", "rsi_macd_divergence_v1", "relative_strength_leader_v1"}
