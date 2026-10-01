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
    assert pending["stage"] == "WATCH_PRICE_CONFIRMATION"
    assert pending["evidence"]["pending_lower_low_on"] == bars[64]["date"]
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
