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
