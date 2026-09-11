from datetime import date, datetime, timezone
from types import SimpleNamespace

from protstock.seed import seed_vnindex_history


def _bar() -> SimpleNamespace:
    return SimpleNamespace(
        trading_date=date(2018, 1, 2), open=1000, high=1010,
        low=995, close=1005, volume=123456,
        source="VNSTOCK_KBS", collected_at=datetime(2026, 9, 11, tzinfo=timezone.utc),
    )


def test_seed_vnindex_fetches_and_upserts(monkeypatch) -> None:
    writes = []

    class Client:
        def market_index(self, code):
            assert code == "VNINDEX"
            return {"id": 9, "code": code}

        def upsert(self, table, rows, conflict):
            writes.append((table, rows, conflict))
            return len(rows)

        def close(self):
            pass

    class Provider:
        def history(self, symbol, start, end):
            assert (symbol, start, end) == ("VNINDEX", date(2018, 1, 1), date(2018, 1, 3))
            return [_bar()]

    monkeypatch.setattr("protstock.seed.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.seed.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.seed.VnstockProvider", lambda source: Provider())
    result = seed_vnindex_history(date(2018, 1, 1), date(2018, 1, 3))

    assert result == {
        "status": "SUCCEEDED", "rows_inserted": 1,
        "start_date": "2018-01-01", "end_date": "2018-01-03", "source_used": "KBS",
    }
    assert writes == [("market_index_prices", [{
        "index_id": 9, "trading_date": "2018-01-02", "open": 1000.0,
        "high": 1010.0, "low": 995.0, "close": 1005.0, "volume": 123456,
        "source": "VNSTOCK_KBS", "collected_at": "2026-09-11T00:00:00+00:00",
    }], "index_id,trading_date")]


def test_seed_vnindex_falls_back_from_kbs_to_vci(monkeypatch) -> None:
    sources = []

    class Client:
        def market_index(self, _code): return {"id": 9}
        def upsert(self, *_args): return 1
        def close(self): pass

    class PrimaryProvider:
        def history(self, *_args): raise TimeoutError("Read timed out")

    class FallbackProvider:
        def history(self, *_args): return [_bar()]

    def provider(source):
        sources.append(source)
        return PrimaryProvider() if source == "KBS" else FallbackProvider()

    monkeypatch.setattr("protstock.seed.Settings.from_env", lambda: object())
    monkeypatch.setattr("protstock.seed.SupabaseRestClient", lambda _settings: Client())
    monkeypatch.setattr("protstock.seed.VnstockProvider", provider)
    result = seed_vnindex_history(date(2018, 1, 1), date(2018, 1, 3), "KBS")

    assert sources == ["KBS", "VCI"]
    assert result["source_used"] == "VCI"
