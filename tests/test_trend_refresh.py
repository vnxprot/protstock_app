import csv
from datetime import date
from pathlib import Path

import pytest

from protstock import trend_refresh


def test_refresh_requires_exact_frozen_277_symbol_manifest():
    symbols = list(csv.DictReader(Path('data/universe.csv').open(encoding='utf-8-sig')))
    class Client:
        def active_symbols(self):
            return symbols
    assert len(trend_refresh.fixed_universe(Client())) == 277
    symbols.pop()
    with pytest.raises(ValueError, match='Frozen universe mismatch'):
        trend_refresh.fixed_universe(Client())


def test_history_refresh_only_writes_dependent_research_and_respects_cutoff(monkeypatch):
    monkeypatch.setattr(trend_refresh, 'fixed_universe', lambda _: [{'id': 1, 'symbol': 'AAA', 'exchange': 'HOSE'}])
    class Client:
        def __init__(self):
            self.writes = []
        def market_index(self, code):
            return {'id': 1}
        def index_price_history(self, *args):
            return self.price_history(*args)
        def price_history(self, *args):
            return [{'trading_date': day, 'open': 10, 'high': 10.2, 'low': 9.8, 'close': 10,
                     'volume': 2_000_000, 'source': 'VCI_V5', 'data_revision': 'canonical',
                     'price_basis': 'VENDOR_CORPORATE_ACTION_ADJUSTED', 'quality_status': 'VALID'}
                    for day in ('2026-09-30', '2026-10-01', '2026-10-02')]
        def _pages(self, *args):
            return []
        def upsert(self, table, rows, conflict):
            self.writes.append((table, rows))
    client = Client()
    result = trend_refresh.refresh_history(client, date(2026, 9, 30), date(2026, 10, 1))
    assert result['failed'] == []
    assert result['sessions'] == 2
    assert {table for table, _ in client.writes} == {'monthly_trend_states', 'signal_funnel_assessments',
        'momentum_radar_assessments', 'challenger_strategy_assessments', 'challenger_signal_assessments'}
    for table, rows in client.writes:
        for row in rows:
            assert (row.get('as_of_date') or row.get('trading_date') or row['period_end']) <= '2026-10-01'
    with pytest.raises(ValueError, match='app history'):
        trend_refresh.refresh_history(client, date(2025, 1, 1), date(2026, 10, 1))
