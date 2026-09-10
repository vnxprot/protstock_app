from datetime import date, timedelta

from protstock.analysis import analyze_bars, resolve_signal
from protstock.calibrate import calibrate_pattern
from protstock.candles import is_bullish_engulfing, is_doji, is_pin_bar
from protstock.patterns import detect_triangle


def _snapshot() -> dict:
    return {"close": 100, "trend_state": "UP", "volume_ratio20": 2, "volume_avg20": 5_000_000, "rsi14": 50, "atr14": 2}


def _bull() -> dict:
    return {"pattern_type": "DOUBLE_BOTTOM", "direction": "BULLISH", "state": "CONFIRMED", "quality_score": 75, "start_date": "2026-01-01", "trigger_price": 100, "invalidation_price": 95, "reasons": ["CANDLESTICK_CONFIRMATION"]}


def test_sector_limit_downgrades_only_concentrated_candidate() -> None:
    concentrated = [{"market_price": 300, "quantity": 1000, "sector": "BANK"}, {"market_price": 400, "quantity": 1000, "sector": "TECH"}]
    action, reasons = resolve_signal([_bull()], _snapshot(), portfolio_positions=concentrated, candidate_sector="BANK", capital=1_000_000)
    assert action == "WATCH"
    assert "SECTOR_CONCENTRATION_LIMIT" in reasons
    diversified = [{"market_price": 700, "quantity": 1000, "sector": "TECH"}]
    assert resolve_signal([_bull()], _snapshot(), portfolio_positions=diversified, candidate_sector="BANK", capital=1_000_000)[0] == "PROBE_BUY"


def test_optional_portfolio_context_is_backward_compatible() -> None:
    pattern, snapshot = _bull(), _snapshot()
    assert resolve_signal([pattern], snapshot) == resolve_signal([pattern], snapshot, portfolio_positions=None)
    bars = _bars(30)
    assert analyze_bars(bars) == analyze_bars(bars, portfolio_positions=None)


def test_calibration_selects_out_of_sample_not_train_metric() -> None:
    bars = [{"phase": "train"}] * 3 + [{"phase": "test"}] * 3

    def runner(window, rule):
        volume = rule["all"][1]["value"]
        phase = window[0]["phase"]
        expectancy = 100 if (phase == "train" and volume == 1.2) or (phase == "test" and volume == 1.6) else 1
        return {"metrics": {"expectancy": expectancy, "total_return": expectancy / 100, "trade_count": 4}}

    report = calibrate_pattern(bars, "DOUBLE_BOTTOM", train_bars=3, test_bars=3, runner=runner)
    assert report["best"]["volume_multiplier"] == 1.6
    assert report["best"]["out_of_sample_trade_count"] == 4


def test_candle_evidence_never_confirms_without_volume() -> None:
    bars = _triangle_bars()
    candidate = detect_triangle(bars)
    assert is_bullish_engulfing(bars[-2], bars[-1]) is True
    assert candidate is not None and candidate.state == "READY"
    assert "CANDLESTICK_CONFIRMATION" not in candidate.reasons


def test_candle_helpers_and_signal_reason_stays_structural() -> None:
    assert is_pin_bar({"open": 99, "high": 101, "low": 90, "close": 100}, "BULLISH")
    assert is_doji({"open": 100, "high": 105, "low": 95, "close": 100.5})
    action, reasons = resolve_signal([_bull()], _snapshot())
    assert action == "PROBE_BUY"
    assert any(reason.startswith("PATTERN_") and reason.endswith("_CONFIRMED") for reason in reasons)
    assert reasons != ["CANDLESTICK_CONFIRMATION"]


def _bars(count: int) -> list[dict]:
    start = date(2026, 1, 1)
    return [{"date": (start + timedelta(days=index)).isoformat(), "open": 100, "high": 101, "low": 99, "close": 100, "volume": 100} for index in range(count)]


def _triangle_bars() -> list[dict]:
    bars = [{"date": f"2026-01-{index + 1:02d}", "open": 99, "high": 101, "low": 90 + index * .6, "close": 99, "volume": 100} for index in range(39)]
    bars[-1].update(open=102, high=102.5, low=99.5, close=100)
    bars.append({"date": "2026-02-10", "open": 99, "high": 103.5, "low": 98.5, "close": 103, "volume": 100})
    return bars
