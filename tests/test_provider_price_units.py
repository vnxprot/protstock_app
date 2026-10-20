from datetime import date
from decimal import Decimal

import pytest

from protstock.market_http import SourceUnavailable
from protstock.provider_market import MarketDataProvider, ProviderDataError


def candle(day="2026-10-19", **values):
    return {"t": day + "T07:00:00+07:00", "o": 20000, "h": 21000,
            "l": 19000, "c": 20500, "v": 1000, **values}


def test_provider_accepts_only_named_sources():
    assert MarketDataProvider("VCI").source == "VCI"
    with pytest.raises(ValueError, match="AUTO"):
        MarketDataProvider("UNKNOWN")


def test_auto_falls_back_on_source_errors_but_not_programming_errors(monkeypatch):
    provider = MarketDataProvider()
    calls = []
    monkeypatch.setattr(provider, "_vci_history", lambda *_: (_ for _ in ()).throw(SourceUnavailable("503")))
    monkeypatch.setattr(provider, "_kbs_history", lambda *args: calls.append(args) or ["complete window"])
    start, end = date(2021, 1, 1), date(2026, 10, 19)
    assert provider.history("FPT", start, end) == ["complete window"]
    assert calls == [("FPT", start, end)]
    monkeypatch.setattr(provider, "_vci_history", lambda *_: (_ for _ in ()).throw(ValueError("bad argument")))
    with pytest.raises(ValueError, match="bad argument"):
        provider.history("FPT", start, end)


def test_empty_no_trade_response_does_not_switch_vendor(monkeypatch):
    provider = MarketDataProvider()
    monkeypatch.setattr(provider, "_vci_history", lambda *_: [])
    monkeypatch.setattr(provider, "_kbs_history", lambda *_: pytest.fail("No trade is not an outage"))
    assert provider.history("FPT", date(2026, 10, 19), date(2026, 10, 19)) == []


def test_vci_keeps_valid_history_around_invalid_old_session(monkeypatch, capsys):
    records = [candle("2021-01-21"), candle("2021-01-22", h=18000), candle("2021-01-25")]
    monkeypatch.setattr("protstock.provider_market.vci_candles", lambda *_: records)
    bars = MarketDataProvider("VCI").history("MML", date(2021, 1, 21), date(2021, 1, 25))
    assert [bar.trading_date for bar in bars] == [date(2021, 1, 21), date(2021, 1, 25)]
    assert "VCI_INVALID_SESSIONS_SKIPPED:MML:2021-01-22" in capsys.readouterr().err
    records.pop()
    with pytest.raises(ProviderDataError, match="Invalid latest VCI bar"):
        MarketDataProvider("VCI").history("MML", date(2021, 1, 21), date(2021, 1, 22))


def test_vci_stock_normalizes_vnd_while_index_keeps_points(monkeypatch):
    monkeypatch.setattr("protstock.provider_market.vci_candles", lambda *_: [candle()])
    day = date(2026, 10, 19)
    stock = MarketDataProvider("VCI").history("FPT", day, day)[0]
    index = MarketDataProvider("VCI").history("VNINDEX", day, day)[0]
    assert stock.close == Decimal("20.5") and stock.volume == 1000
    assert index.close == Decimal("20500") and stock.source == "VCI_DIRECT"


def test_kbs_stock_units_and_late_session_buffer(monkeypatch):
    seen = {}
    def request(_method, _url, **kwargs):
        seen.update(kwargs["params"])
        return {"data_day": [candle("2026-10-19"), candle("2026-10-20")]}
    monkeypatch.setattr("protstock.provider_market.request_json", request)
    day = date(2026, 10, 19)
    stocks = MarketDataProvider("KBS").history("FPT", day, day)
    assert seen["edate"] == "21-10-2026"
    assert len(stocks) == 1 and stocks[0].close == Decimal("20.5")
    assert MarketDataProvider("KBS").history("VNINDEX", day, day)[0].close == Decimal("20500")
