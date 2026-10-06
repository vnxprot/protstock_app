from protstock.provider_vnstock import STOCK_PRICE_UNIT
from protstock.run_challenger_shadow import run_shadow_session


def test_shadow_runner_reads_prices_and_only_invokes_isolated_writer(monkeypatch):
    called = []

    class Client:
        def _pages(self, table, params, limit=None):
            assert table == "market_breadth_snapshots"
            return [{"trading_date": "2026-10-05", "vnindex_trend_state": "UP",
                     "pct_above_sma50": 60, "coverage_status": "COMPLETE"}]

        def active_symbols(self):
            return [{"id": 1, "symbol": "AAA", "exchange": "HOSE"}]

        def price_history(self, symbol_id, limit):
            assert (symbol_id, limit) == (1, 900)
            return [{"trading_date": "2026-10-02", "open": 10, "high": 11, "low": 9,
                     "close": 10, "volume": 1_000_000, "quality_status": "LEGACY_UNVERIFIED", "price_unit": STOCK_PRICE_UNIT},
                    {"trading_date": "2026-10-05", "open": 10, "high": 11, "low": 9,
                     "close": 10, "volume": 1_000_000, "quality_status": "VALID", "price_unit": STOCK_PRICE_UNIT}]

    def writer(client, pending, market_context, day, counts, warnings):
        called.append((pending, market_context, day))
        counts["challenger_shadow"] = len(pending)

    monkeypatch.setattr("protstock.run_challenger_shadow._write_challenger_shadow", writer)
    result = run_shadow_session(Client())
    assert result["priced_symbols"] == result["challenger_shadow"] == 1
    assert called[0][0][0][1] == "D"
    assert called[0][2].isoformat() == "2026-10-05"
