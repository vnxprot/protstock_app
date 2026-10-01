from datetime import date, timedelta
from types import SimpleNamespace

from protstock.macd_divergence import assess_macd_divergence
from protstock.engines import evaluate_named_engine
from protstock.macd_replay import _outcome
from protstock.provider_vnstock import KBS_SOURCE_VERSION
from protstock.research_prices import research_price_rows


def _candidate_bars():
    prices = [30.0] * 35 + [29, 27, 24, 22, 24, 25, 26, 25, 24, 23, 22, 21, 23, 24, 25, 26, 27]
    return [{"date": (date(2026, 1, 1) + timedelta(days=i)).isoformat(),
             "open": price, "high": price + .3, "low": price - .3,
             "close": price, "volume": 100_000} for i, price in enumerate(prices)]


def test_divergence_waits_for_closed_pivot_and_price_confirmation():
    bars = _candidate_bars()
    assert not assess_macd_divergence(1, bars[:48])
    setup = assess_macd_divergence(1, bars[:49])[0]
    assert setup["oscillator"] == "MACD_HISTOGRAM"
    assert setup["swings"] == 2
    assert setup["stage"] == "WATCH_PRICE_CONFIRMATION"
    assert setup["confirmed_on"] == bars[48]["date"]
    confirmed = assess_macd_divergence(1, bars)[0]
    assert confirmed["setup_id"] == setup["setup_id"]
    assert confirmed["stage"] == "CONFIRMED"
    assert confirmed["trigger_date"] == bars[-1]["date"]


def test_invalidation_prevents_later_revival():
    bars = _candidate_bars()
    bars.insert(-1, {**bars[-1], "date": "2026-02-21", "open": 20, "high": 20.2,
                     "low": 19.8, "close": 20})
    bars[-1]["date"] = "2026-02-22"
    setup = next(row for row in assess_macd_divergence(1, bars)
                 if row["oscillator"] == "MACD_HISTOGRAM")
    assert setup["stage"] == "INVALIDATED"
    assert setup["trigger_date"] is None


def test_divergence_is_invariant_to_share_price_unit():
    bars = _candidate_bars()
    scaled = [{**bar, **{field: bar[field] * 10 for field in ("open", "high", "low", "close")}}
              for bar in bars]
    original = assess_macd_divergence(1, bars)
    rebased = assess_macd_divergence(1, scaled)
    assert [(row["oscillator"], row["swings"], row["stage"]) for row in original] == [
        (row["oscillator"], row["swings"], row["stage"]) for row in rebased]
    assert original[0]["evidence"]["oscillator_basis"] == "MACD_PCT_OF_CLOSE"
    assert [pivot["oscillator"] for pivot in original[0]["evidence"]["pivots"]] == [
        pivot["oscillator"] for pivot in rebased[0]["evidence"]["pivots"]]
    assert rebased[0]["trigger_price"] == original[0]["trigger_price"] * 10


def test_four_troughs_produce_three_segments_and_rule_signal(monkeypatch):
    from protstock import macd_divergence

    bars = [{"date": (date(2026, 1, 1) + timedelta(days=i)).isoformat(),
             "open": 20, "high": 20.5, "low": 19, "close": 20, "volume": 100_000}
            for i in range(60)]
    troughs = (32, 40, 48, 56)
    for index, low in zip(troughs, (10, 9, 8, 7)):
        bars[index]["low"] = low
    line = [0.0] * len(bars)
    for index, value in zip(troughs, (-.4, -.3, -.2, -.1)):
        line[index] = value
    monkeypatch.setattr(macd_divergence, "_macd_series", lambda closes: (line, [None] * len(closes)))
    setups = assess_macd_divergence(7, bars)
    assert [row["swings"] for row in setups] == [2, 3, 4]
    assert [len(row["evidence"]["pivots"]) for row in setups] == [2, 3, 4]
    context = {"timeframe": "D", "symbol_id": 7, "bars": bars, "data_date": bars[-1]["date"]}
    assert evaluate_named_engine("macd_bullish_divergence_v3", {}, context)[:2] == (True, "WATCH")
    assert context["engine_evidence"]["segments"] == 3
    bars[-1] = {**bars[-1], "close": 21, "high": 21.2}
    context = {**context, "bars": bars}
    assert evaluate_named_engine("macd_bullish_divergence_v3", {}, context)[:2] == (True, "PROBE_BUY")


def test_research_series_quarantines_scale_jump_and_preserves_source():
    bars = [SimpleNamespace(trading_date=date(2026, 9, day), open=value,
                            high=value + 1, low=value - 1, close=value,
                            volume=100, collected_at=SimpleNamespace(isoformat=lambda: "2026-10-01T00:00:00Z"))
            for day, value in [(1, 88), (2, 22), (3, 21)]]
    rows = research_price_rows(1, "TRC", bars)
    assert rows[0]["quality_status"] == "QUARANTINED"
    assert rows[1]["quality_status"] == "QUARANTINED"
    assert rows[2]["quality_status"] == "VALID"
    assert all(row["volume"] == 400 for row in rows)
    assert all(row["volume_adjustment_factor"] == 4 for row in rows)
    assert all(row["source_version"] == KBS_SOURCE_VERSION for row in rows)
    after = SimpleNamespace(**{**bars[-1].__dict__, "trading_date": date(2026, 9, 15)})
    assert research_price_rows(1, "TRC", [after])[0]["volume_adjustment_factor"] == 1


def test_outcome_uses_next_open_and_includes_fees_and_tax():
    bars = [{"trading_date": f"2026-09-{day:02d}", "open": 10,
             "close": 10, "source_version": KBS_SOURCE_VERSION,
             "quality_status": "VALID"} for day in range(1, 8)]
    assessment = {"setup_id": "setup", "oscillator": "MACD_LINE",
                  "trigger_date": "2026-09-01"}
    result = _outcome(1, assessment, bars, 0, 5)
    assert result is not None
    assert result["entry_date"] == "2026-09-02"
    assert result["net_return"] < 0
    assert _outcome(1, assessment, bars[:4], 0, 5) is None
