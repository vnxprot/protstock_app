from datetime import date
from decimal import Decimal

from protstock.provider_vnstock import VnstockProvider


class Response:
    def __init__(self, close):
        self.close = close

    def raise_for_status(self):
        pass

    def json(self):
        return {"data_day": [{"t": "2026-09-25 07:00", "o": self.close, "h": self.close, "l": self.close, "c": self.close, "v": 1000}]}


def test_kbs_stock_prices_are_stored_in_thousand_vnd(monkeypatch):
    monkeypatch.setattr("protstock.provider_vnstock.httpx.get", lambda *args, **kwargs: Response(27800))
    bars = VnstockProvider().history("HDB", date(2026, 9, 25), date(2026, 9, 25))
    assert bars[0].close == Decimal("27.8")
    assert bars[0].open == bars[0].high == bars[0].low == bars[0].close


def test_kbs_index_remains_in_points(monkeypatch):
    monkeypatch.setattr("protstock.provider_vnstock.httpx.get", lambda *args, **kwargs: Response(1800))
    bars = VnstockProvider().history("VNINDEX", date(2026, 9, 25), date(2026, 9, 25))
    assert bars[0].close == Decimal("1800")


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
    bars = VnstockProvider().history("HDB", date(2026, 9, 15), date(2026, 9, 25))
    assert seen["edate"] == "27-09-2026"
    assert [bar.trading_date for bar in bars] == [date(2026, 9, 25)]
