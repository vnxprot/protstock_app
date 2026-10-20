from datetime import date, datetime, timezone, timedelta

import pytest

from protstock import market_sources as sources
from protstock.market_http import SourceUnavailable


def block(symbol, days):
    stamps = [int(datetime.fromisoformat(day).replace(tzinfo=timezone(timedelta(hours=7))).timestamp()) for day in days]
    return [{"symbol": symbol, "t": stamps, **{key: [value] * len(days)
             for key, value in {"o": 20000, "h": 21000, "l": 19000, "c": 20500, "v": 1000}.items()}}]


def test_daily_pagination_does_not_assume_a_short_page_is_complete(monkeypatch):
    calls = []
    pages = [block("FPT", ["2026-10-19", "2026-10-16"]), block("FPT", ["2026-10-15", "2026-10-14"])]
    def request(_method, _url, **kwargs):
        calls.append(kwargs["json"])
        return pages.pop(0)
    monkeypatch.setattr(sources, "request_json", request)
    result = sources.vci_candles("FPT", date(2026, 10, 14), date(2026, 10, 19))
    assert len(result) == 4 and calls[1]["to"] < calls[0]["to"]


def test_minute_windows_preserve_timezone_and_bound_response(monkeypatch):
    calls = []
    def request(_method, _url, **kwargs):
        calls.append(kwargs["json"])
        return block("FPT", ["2026-10-16T00:00:00"])
    monkeypatch.setattr(sources, "request_json", request)
    result = sources.vci_candles("FPT", date(2026, 10, 16), date(2026, 10, 19), minute=True)
    assert len(calls) == 2 and all(call["timeFrame"] == "ONE_MINUTE" for call in calls)
    assert len(result) == 1 and result[0]["t"].endswith("+07:00")


def test_wrong_symbol_and_broken_arrays_are_rejected(monkeypatch):
    monkeypatch.setattr(sources, "request_json", lambda *_args, **_kwargs: block("BIC", ["2026-10-19"]))
    with pytest.raises(SourceUnavailable, match="wrong symbol"):
        sources.vci_candles("FPT", date(2026, 10, 19), date(2026, 10, 19))
    response = block("FPT", ["2026-10-19"])
    response[0]["v"] = []
    monkeypatch.setattr(sources, "request_json", lambda *_args, **_kwargs: response)
    with pytest.raises(SourceUnavailable, match="inconsistent"):
        sources.vci_candles("FPT", date(2026, 10, 19), date(2026, 10, 19))


def test_directory_normalizes_vci_and_kbs(monkeypatch):
    monkeypatch.setattr(sources, "request_json", lambda *_args, **_kwargs: [
        {"symbol": "FPT", "board": "HSX", "type": "STOCK", "organName": "FPT"},
        {"symbol": "BOND1", "board": "HOSE", "type": "BOND"}])
    assert sources.directory() == [{"symbol": "FPT", "exchange": "HOSE", "company_name": "FPT", "source": "VCI"}]


def test_events_are_normalized_and_empty_response_is_valid(monkeypatch):
    monkeypatch.setattr(sources, "request_json", lambda *_args, **_kwargs:
                        {"data": {"content": [{"id": "event", "eventCode": "DIV", "exrightDate": "2026-10-19T00:00:00"}], "last": True}})
    result = sources.vci_events("FPT", date(2021, 1, 1), date(2026, 10, 19))
    assert result[0]["event_code"] == "DIV" and result[0]["exright_date"].startswith("2026-10-19")
