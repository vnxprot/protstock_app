from datetime import date
from decimal import Decimal
from types import SimpleNamespace
import sys

from protstock.provider_vnstock import ProviderDataError, VnstockProvider


def test_provider_accepts_only_named_sources():
    import pytest
    assert VnstockProvider("VCI").source == "VCI"
    assert VnstockProvider("AUTO").source == "AUTO"
    with pytest.raises(ValueError, match="AUTO"):
        VnstockProvider("UNKNOWN")


def test_auto_replaces_whole_invalid_vci_window_with_kbs(monkeypatch):
    import pytest

    provider = VnstockProvider("AUTO")
    requests = []
    start, end = date(2026, 9, 1), date(2026, 9, 25)

    def invalid_vci(symbol, first, last):
        requests.append(("VCI", symbol, first, last))
        raise ProviderDataError("Invalid VCI bar")

    def kbs_window(symbol, first, last):
        requests.append(("KBS", symbol, first, last))
        return ["complete KBS window"]

    monkeypatch.setattr(provider, "_vci_history", invalid_vci)
    monkeypatch.setattr(provider, "_kbs_history", kbs_window)
    assert provider.history("MPC", start, end) == ["complete KBS window"]
    assert requests == [("VCI", "MPC", start, end), ("KBS", "MPC", start, end)]

    monkeypatch.setattr(provider, "_vci_history", lambda *_: (_ for _ in ()).throw(ValueError("bad argument")))
    with pytest.raises(ValueError, match="bad argument"):
        provider.history("MPC", start, end)


def test_vci_keeps_valid_history_around_one_invalid_old_session(monkeypatch, capsys):
    import pytest

    class Frame:
        attrs = {"source": "vci"}
        def itertuples(self, index=False):
            return iter([
                SimpleNamespace(time="2021-01-21", open=10, high=11, low=9, close=10, volume=100),
                SimpleNamespace(time="2021-01-22", open=10, high=9, low=8, close=10, volume=100),
                SimpleNamespace(time="2021-01-25", open=10, high=11, low=9, close=10, volume=100),
            ])
    class Market:
        def equity(self, _symbol): return self
        def ohlcv(self, **_kwargs): return Frame()
    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(Market=Market, __version__="5.0.0"))
    bars = VnstockProvider("VCI").history("MML", date(2021, 1, 21), date(2021, 1, 25))
    assert [bar.trading_date for bar in bars] == [date(2021, 1, 21), date(2021, 1, 25)]
    assert "VCI_INVALID_SESSIONS_SKIPPED:MML:2021-01-22" in capsys.readouterr().err

    class LatestInvalidFrame(Frame):
        def itertuples(self, index=False):
            return iter(list(Frame().itertuples())[:2])
    class LatestInvalidMarket(Market):
        def ohlcv(self, **_kwargs): return LatestInvalidFrame()
    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(Market=LatestInvalidMarket, __version__="5.0.0"))
    with pytest.raises(ProviderDataError, match="Invalid latest VCI bar"):
        VnstockProvider("VCI").history("MML", date(2021, 1, 21), date(2021, 1, 22))


class Response:
    def __init__(self, close):
        self.close = close

    def raise_for_status(self):
        pass

    def json(self):
        return {"data_day": [{"t": "2026-09-25 07:00", "o": self.close, "h": self.close, "l": self.close, "c": self.close, "v": 1000}]}


def test_kbs_stock_prices_are_stored_in_thousand_vnd(monkeypatch):
    monkeypatch.setattr("protstock.provider_vnstock.httpx.get", lambda *args, **kwargs: Response(27800))
    bars = VnstockProvider("KBS").history("HDB", date(2026, 9, 25), date(2026, 9, 25))
    assert bars[0].close == Decimal("27.8")
    assert bars[0].open == bars[0].high == bars[0].low == bars[0].close


def test_kbs_index_remains_in_points(monkeypatch):
    monkeypatch.setattr("protstock.provider_vnstock.httpx.get", lambda *args, **kwargs: Response(1800))
    bars = VnstockProvider("KBS").history("VNINDEX", date(2026, 9, 25), date(2026, 9, 25))
    assert bars[0].close == Decimal("1800")


def test_vci_index_is_requested_before_fallback(monkeypatch):
    class Frame:
        attrs = {"source": "vci"}
        def itertuples(self, index=False):
            return iter([SimpleNamespace(time="2026-09-25", open=1800, high=1810,
                                         low=1790, close=1805, volume=1000)])
    class Market:
        def index(self, symbol):
            assert symbol == "VNINDEX"
            return self
        def equity(self, symbol):
            raise AssertionError(f"Unexpected equity request: {symbol}")
        def ohlcv(self, **kwargs):
            assert kwargs["source"] == "vci"
            return Frame()
    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(Market=Market, __version__="5.0.0"))
    bars = VnstockProvider().history("VNINDEX", date(2026, 9, 25), date(2026, 9, 25))
    assert bars[0].source.startswith("VCI_") and bars[0].close == Decimal("1805")


def test_vci_long_history_is_requested_in_complete_year_windows(monkeypatch):
    requests = []

    class Frame:
        attrs = {"source": "vci"}

        def __init__(self, first):
            self.first = first

        def itertuples(self, index=False):
            return iter([SimpleNamespace(time=self.first, open=10, high=11,
                                         low=9, close=10, volume=100)])

    class Market:
        def equity(self, symbol):
            assert symbol == "HPG"
            return self

        def ohlcv(self, **kwargs):
            requests.append((date.fromisoformat(kwargs["start"]), date.fromisoformat(kwargs["end"])))
            return Frame(kwargs["start"])

    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(Market=Market, __version__="5.0.0"))
    bars = VnstockProvider("VCI").history("HPG", date(2021, 1, 1), date(2026, 10, 13))
    assert len(requests) == len(bars) == 6
    assert requests[0][0] == date(2021, 1, 1)
    assert requests[-1][1] == date(2026, 10, 13)
    assert all(later[0].toordinal() == earlier[1].toordinal() + 1
               for earlier, later in zip(requests, requests[1:]))


def test_vci_minute_quota_retries_only_the_interrupted_window(monkeypatch):
    class EntitlementError(Exception):
        pass

    calls = []
    waits = []

    class Frame:
        attrs = {"source": "vci"}

        def __init__(self, day): self.day = day

        def itertuples(self, index=False):
            return iter([SimpleNamespace(time=self.day, open=10, high=11,
                                         low=9, close=10, volume=100)])

    class Market:
        def equity(self, _symbol): return self

        def ohlcv(self, **kwargs):
            calls.append(kwargs["start"])
            if len(calls) == 2:
                raise EntitlementError("The per-minute quota has been reached (60/60 calls)")
            return Frame(kwargs["start"])

    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(Market=Market, __version__="5.0.0"))
    monkeypatch.setattr("protstock.provider_vnstock.sleep", waits.append)
    bars = VnstockProvider("VCI").history("HPG", date(2021, 1, 1), date(2022, 1, 2))
    assert len(bars) == 2
    assert calls == ["2021-01-01", "2022-01-01", "2022-01-01"]
    assert waits == [65]


def test_kbs_request_includes_late_friday_but_filters_future_dates(monkeypatch):
    seen = {}

    class BufferedResponse(Response):
        def json(self):
            return {"data_day": [
                {"t": "2026-09-25 07:00", "o": 27800, "h": 27800, "l": 27800, "c": 27800, "v": 1000},
                {"t": "2026-09-28 07:00", "o": 28000, "h": 28000, "l": 28000, "c": 28000, "v": 1000},
            ]}

    def fake_get(*args, **kwargs):
        seen.update(kwargs["params"])
        return BufferedResponse(27800)

    monkeypatch.setattr("protstock.provider_vnstock.httpx.get", fake_get)
    bars = VnstockProvider("KBS").history("HDB", date(2026, 9, 15), date(2026, 9, 25))
    assert seen["edate"] == "27-09-2026"
    assert [bar.trading_date for bar in bars] == [date(2026, 9, 25)]
