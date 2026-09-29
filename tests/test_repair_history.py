from datetime import date, datetime, timezone
from types import SimpleNamespace

from protstock.repair_history import repair_missing_history
import pytest


def test_repair_history_fetches_and_writes_only_missing_sessions(monkeypatch) -> None:
    writes = []

    class Client:
        def market_index(self, _code): return {"id": 1}
        def index_price_dates(self, *_args): return ["2021-01-04", "2021-01-05"]
        def active_symbols(self): return [{"id": 7, "symbol": "AAA"}]
        def symbol_price_dates(self, *_args): return ["2021-01-04"]
        def upsert(self, table, rows, conflict):
            writes.append((table, list(rows), conflict)); return len(writes[-1][1])
        def close(self): pass

    class Provider:
        def __init__(self, _source): pass
        def history(self, symbol, start, end):
            bars = [
                SimpleNamespace(trading_date=date(2021, 1, 4), open=1, high=2, low=1, close=2, volume=10, source="KBS", collected_at=datetime(2021, 1, 5, tzinfo=timezone.utc)),
                SimpleNamespace(trading_date=date(2021, 1, 5), open=2, high=3, low=2, close=3, volume=20, source="KBS", collected_at=datetime(2021, 1, 5, tzinfo=timezone.utc)),
            ]
            if symbol == "VNINDEX":
                assert (start, end) == (date(2021, 1, 4), date(2021, 1, 5))
                return bars
            assert (symbol, start, end) == ("AAA", date(2021, 1, 5), date(2021, 1, 5))
            return bars

    monkeypatch.setattr("protstock.repair_history.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.repair_history.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.repair_history.VnstockProvider", Provider)
    monkeypatch.setattr("protstock.repair_history.sleep", lambda _seconds: None)

    result = repair_missing_history(date(2021, 1, 4), date(2021, 1, 5), pause_seconds=0)

    assert result["vnindex"]["rows_written"] == 0
    assert result["rows_written"] == 1
    assert writes[0][0] == "daily_prices"
    assert writes[0][1][0]["trading_date"] == "2021-01-05"


def test_full_range_backfills_before_first_observation_without_overwriting(monkeypatch) -> None:
    writes = []

    class Client:
        def active_symbols(self): return [{"id": 7, "symbol": "AAA"}]
        def symbol_price_dates(self, *_args): return ["2026-09-28"]
        def upsert(self, table, rows, conflict):
            writes.extend(rows); return len(rows)
        def close(self): pass

    class Provider:
        def __init__(self, _source): pass
        def history(self, symbol, start, end):
            assert (symbol, start, end) == ("AAA", date(2021, 1, 1), date(2026, 9, 28))
            return [SimpleNamespace(trading_date=day, open=1, high=2, low=1, close=2, volume=10, source="KBS", collected_at=datetime(2026, 9, 28, tzinfo=timezone.utc)) for day in (date(2021, 1, 4), date(2026, 9, 28))]

    monkeypatch.setattr("protstock.repair_history.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.repair_history.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.repair_history.VnstockProvider", Provider)
    monkeypatch.setattr("protstock.repair_history.sleep", lambda _seconds: None)
    result = repair_missing_history(date(2021, 1, 1), date(2026, 9, 28), symbols={"AAA"}, pause_seconds=0, full_range=True)
    assert result["rows_written"] == 1
    assert [row["trading_date"] for row in writes] == ["2021-01-04"]


def test_full_range_requires_explicit_symbols() -> None:
    with pytest.raises(ValueError, match="explicit symbol list"):
        repair_missing_history(date(2021, 1, 1), date(2026, 9, 28), full_range=True)
