from datetime import date, timedelta

from protstock import macd_divergence_zones as zone_rule
from protstock.engines import evaluate_macd_bullish_divergence_v4


def _bars() -> list[dict]:
    rows = []
    for index in range(68):
        close = 30.0
        rows.append({
            "date": (date(2026, 6, 1) + timedelta(days=index)).isoformat(),
            "open": close, "high": 31.0, "low": 29.0, "close": close,
            "volume": 100.0,
        })
    for index, low in ((30, 25.0), (40, 24.0), (50, 23.0), (60, 22.1), (64, 22.0)):
        rows[index]["low"] = low
    rows[67].update(close=32.0, high=33.0, low=31.0, volume=200.0)
    return rows


def _line(closes: list[float]) -> tuple[list[float], list[float]]:
    normalized = [0.0] * len(closes)
    for index, low in ((31, -4.0), (41, -3.0), (51, -2.0), (61, -1.0), (64, -.9)):
        if index < len(closes):
            normalized[index] = low
    # Histogram is deliberately unrelated; V4 must never use it.
    return [value * closes[index] / 100 for index, value in enumerate(normalized)], [-99.0] * len(closes)


def test_four_price_zones_revise_recent_low_and_breakout_only_when_closed(monkeypatch) -> None:
    monkeypatch.setattr(zone_rule, "_macd_series", _line)
    bars = _bars()
    first = zone_rule.assess_macd_zone_divergence(7, bars[:63], "HOSE")
    four = next(row for row in first if row["swings"] == 4)
    assert four["stage"] == "WATCH_PRICE_CONFIRMATION"
    assert [zone["price_low"] for zone in four["evidence"]["zones"]] == [25, 24, 23, 22.1]
    assert [zone["macd_low"] for zone in four["evidence"]["zones"]] == [-4, -3, -2, -1]
    assert four["evidence"]["zones"][0]["price_date"] != four["evidence"]["zones"][0]["macd_date"]
    pending = next(row for row in zone_rule.assess_macd_zone_divergence(7, bars[:66], "HOSE") if row["swings"] == 4)
    assert pending["stage"] == "WATCH_PIVOT_CONFIRMATION"
    assert pending["confirmed_on"] is None
    assert pending["evidence"]["zones"][-1]["price_date"] == bars[64]["date"]
    revised = next(row for row in zone_rule.assess_macd_zone_divergence(7, bars[:67], "HOSE") if row["swings"] == 4)
    assert revised["stage"] == "WATCH_PRICE_CONFIRMATION"
    assert revised["evidence"]["zones"][-1]["price_low"] == 22.0
    assert len(revised["evidence"]["zones"][-1]["revisions"]) == 2
    breakout = next(row for row in zone_rule.assess_macd_zone_divergence(7, bars, "HOSE") if row["swings"] == 4)
    assert breakout["stage"] == "CONFIRMED"
    assert breakout["trigger_date"] == bars[-1]["date"]
    assert breakout["evidence"]["breakout_volume_ratio20"] == 2.0
    assert breakout["oscillator"] == "MACD_LINE"


def test_v4_emits_buy_only_on_volume_confirmed_breakout_day(monkeypatch) -> None:
    monkeypatch.setattr(zone_rule, "_macd_series", _line)
    bars = _bars()
    context = {"timeframe": "D", "symbol_id": 7, "candidate_exchange": "HOSE", "bars": bars,
               "data_date": bars[-1]["date"]}
    emitted, action, reasons = evaluate_macd_bullish_divergence_v4(context)
    assert emitted and action == "PROBE_BUY"
    assert "MACD_ZONE_DIVERGENCE_3_SEGMENTS" in reasons
    assert context["engine_evidence"]["oscillator"] == "MACD_LINE"
    bars[-1]["volume"] = 110
    emitted, action, reasons = evaluate_macd_bullish_divergence_v4(context)
    assert emitted and action == "WATCH" and "BREAKOUT_VOLUME_UNCONFIRMED" in reasons
    bars.append({**bars[-1], "date": (date.fromisoformat(bars[-1]["date"]) + timedelta(days=1)).isoformat(),
                 "open": 32.0, "high": 32.5, "low": 31.5, "close": 32.2, "volume": 100.0})
    context["data_date"] = bars[-1]["date"]
    emitted, action, reasons = evaluate_macd_bullish_divergence_v4(context)
    assert emitted and action == "WATCH" and "RECENT_PRICE_BREAKOUT" in reasons


def test_sweep_low_is_provisional_then_breaks_out_on_pivot_confirmation_day(monkeypatch) -> None:
    def line(closes: list[float]) -> tuple[list[float], list[float]]:
        values = [1.0] * len(closes)
        values[30] = -1.149
        values[63] = 0.573
        return [value * close / 100 for value, close in zip(values, closes)], [0.0] * len(closes)

    monkeypatch.setattr(zone_rule, "_macd_series", line)
    bars = []
    for index in range(68):
        bars.append({"date": (date(2026, 7, 5) + timedelta(days=index)).isoformat(),
                     "open": 52.0, "high": 53.8, "low": 49.0, "close": 52.0, "volume": 100.0})
    bars[30]["low"] = 47.0
    bars[45]["high"] = 54.4
    bars[65].update(open=50.0, high=51.5, low=46.4, close=51.2)
    bars[66]["close"] = 52.3
    bars[67].update(open=53.0, high=55.5, low=52.0, close=55.1, volume=1000.0)

    early = next(row for row in zone_rule.assess_macd_zone_divergence(7, bars[:66], "HOSE") if row["swings"] == 2)
    assert early["stage"] == "WATCH_PIVOT_CONFIRMATION"
    assert early["confirmed_on"] is None
    assert early["evidence"]["sweep_reversal"] is True
    confirmed = next(row for row in zone_rule.assess_macd_zone_divergence(7, bars, "HOSE") if row["swings"] == 2)
    assert confirmed["stage"] == "CONFIRMED"
    assert confirmed["confirmed_on"] == bars[67]["date"] == confirmed["trigger_date"]
    assert confirmed["trigger_price"] == 54.4
    assert confirmed["evidence"]["breakout_volume_ratio20"] == 10.0

    context = {"timeframe": "D", "symbol_id": 7, "candidate_exchange": "HOSE", "bars": bars,
               "data_date": bars[67]["date"]}
    assert evaluate_macd_bullish_divergence_v4(context)[1] == "PROBE_BUY"
    bars.append({**bars[-1], "date": (date.fromisoformat(bars[-1]["date"]) + timedelta(days=1)).isoformat(),
                 "high": 54.5, "low": 53.0, "close": 54.0, "volume": 100.0})
    context["data_date"] = bars[-1]["date"]
    assert evaluate_macd_bullish_divergence_v4(context)[1] == "WATCH"


def test_price_zone_divergence_accepts_sixty_sessions_but_not_sixty_one(monkeypatch) -> None:
    def line(closes: list[float]) -> tuple[list[float], list[float]]:
        values = [0.0] * len(closes)
        values[30] = -4.0
        values[90] = -3.0
        values[91] = -3.0
        return [value * close / 100 for value, close in zip(values, closes)], [0.0] * len(closes)

    monkeypatch.setattr(zone_rule, "_macd_series", line)
    for separation, expected in ((60, True), (61, False)):
        rows = [{"date": (date(2026, 1, 1) + timedelta(days=index)).isoformat(),
                 "open": 30.0, "high": 31.0, "low": 29.0, "close": 30.0, "volume": 100.0}
                for index in range(95)]
        rows[30]["low"] = 25.0
        rows[30 + separation]["low"] = 24.0
        pairs = [row for row in zone_rule.assess_macd_zone_divergence(7, rows, "HOSE")
                 if row["swings"] == 2]
        assert bool(pairs) is expected
        if expected:
            assert pairs[0]["evidence"]["zones"][-1]["price_date"] == rows[90]["date"]


def test_breakout_captured_when_price_surges_before_confirmation(monkeypatch) -> None:
    """NKG-style: price crosses trigger before pivot T+2 confirmation day."""
    monkeypatch.setattr(zone_rule, "_macd_series", _line)
    bars = _bars()
    # Simulate price already above trigger at confirmation day (index 66).
    # trigger = max High between indices 60+1..64 = 31.0 (all highs are 31.0 by default).
    # Set close at index 65 (day before confirmed_index=66) already > 31.0.
    bars[65] = {**bars[65], "close": 32.5, "high": 33.0}
    # With old code: ordered[66-1]["close"] = 32.5 > trigger → condition never met → trigger_index = None.
    # With new code: backtrack finds first cross at index 65 → CONFIRMED.
    result = zone_rule.assess_macd_zone_divergence(7, bars[:67], "HOSE")
    four = next(row for row in result if row["swings"] == 4)
    assert four["stage"] == "CONFIRMED", "Trigger must be detected even if price surged before confirmation"
    assert four["trigger_date"] is not None


def test_get_tick_size_all_exchanges(monkeypatch) -> None:
    """Tick size rules per exchange rulebook."""
    tick = zone_rule.get_tick_size
    # HOSE stock
    assert tick(5.0, "HOSE") == 0.01
    assert tick(10.0, "HOSE") == 0.05
    assert tick(50.0, "HOSE") == 0.10
    assert tick(100.0, "HOSE") == 0.10
    # HOSE ETF/CW
    assert tick(15.0, "HOSE", "ETF") == 0.01
    assert tick(15.0, "HOSE", "CW") == 0.01
    # HNX / UPCOM stock
    assert tick(10.0, "HNX") == 0.10
    assert tick(50.0, "UPCOM") == 0.10
    # HNX ETF
    assert tick(10.0, "HNX", "ETF") == 0.001
    # Unknown exchange fallback
    assert tick(30.0, None) == 0.05
    # Backward-compat alias
    assert zone_rule._quote_tick is zone_rule.get_tick_size


def test_local_trigger_added_when_zone_gap_wide(monkeypatch) -> None:
    """Local trigger is populated when two bottoms are more than 20 sessions apart."""
    def line(closes: list[float]) -> tuple[list[float], list[float]]:
        values = [0.0] * len(closes)
        values[30] = -4.0
        values[55] = -3.0
        return [value * close / 100 for value, close in zip(values, closes)], [0.0] * len(closes)

    monkeypatch.setattr(zone_rule, "_macd_series", line)
    rows = [{"date": (date(2026, 3, 1) + timedelta(days=index)).isoformat(),
             "open": 30.0, "high": 31.0, "low": 29.0, "close": 30.0, "volume": 100.0}
            for index in range(80)]
    rows[30]["low"] = 25.0
    rows[55]["low"] = 24.0
    # Place a local high near bottom 2 that is below major trigger
    rows[50]["high"] = 28.5  # local resistance candidate
    result = zone_rule.assess_macd_zone_divergence(7, rows, "HOSE")
    pair = next((r for r in result if r["swings"] == 2), None)
    assert pair is not None
    ev = pair["evidence"]
    # gap = 55 - 30 = 25 > 20 → local trigger should be populated
    assert ev["local_trigger_price"] is not None, "local_trigger_price should be set for wide gap"
    assert ev["local_trigger_date"] is not None
    assert ev["local_trigger_price"] < pair["trigger_price"], "local trigger must be below major trigger"
    assert ev["gain_from_trough_pct"] is not None
