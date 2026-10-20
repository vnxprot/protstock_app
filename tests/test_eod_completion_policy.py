import importlib.util
from pathlib import Path


def load(name):
    path = Path(__file__).resolve().parents[1] / '.github/scripts' / f'{name}.py'
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_missing_candle_is_never_retried(monkeypatch, tmp_path):
    module = load('eod_shard')
    calls = []
    monkeypatch.setenv('SYMBOL_MANIFEST', 'AAA')
    monkeypatch.setenv('TRADING_DATE', '2026-10-20')
    monkeypatch.setenv('RUNNER_TEMP', str(tmp_path))
    monkeypatch.setattr(module, 'run_eod', lambda *a, **k: calls.append(k) or {'job_id': 'one', 'failed': 0})
    class Client:
        def __init__(self, *args): pass
        def _pages(self, *args): return [{'item_key': 'AAA', 'status': 'SKIPPED', 'error_message': 'No candle'}]
        def close(self): pass
    monkeypatch.setattr(module.Settings, 'from_env', lambda: None)
    monkeypatch.setattr(module, 'SupabaseRestClient', Client)
    monkeypatch.setattr(module, 'sleep', lambda seconds: (_ for _ in ()).throw(AssertionError('Unexpected retry')))
    module.main()
    assert len(calls) == 1


def test_intraday_two_lots_exclude_missing_eod_and_stop_after_one_attempt(monkeypatch):
    module = load('intraday_radar_schedule')
    outputs, writes = [], []
    session = []
    def read(client, table, params):
        if table == 'job_runs':
            return [{'status': 'SUCCEEDED', 'finished_at': '2026-10-20T09:00:00Z',
                     'counts': {'publication_status': 'COMPLETE_WITH_MISSING'}}]
        return session
    class Client:
        def active_symbols(self): return [{'id': i, 'symbol': f'S{i}'} for i in range(1, 7)]
        def daily_snapshots_for_date(self, day): return [{'symbol_id': i} for i in range(1, 6)]
        def daily_price_symbol_ids(self, day): return set(range(1, 7))
        def upsert(self, table, rows, conflict): writes.append((table, rows))
    monkeypatch.delenv('FORCE_REFRESH', raising=False)
    monkeypatch.setattr(module, 'read', read)
    monkeypatch.setattr(module, 'write_output', lambda **values: outputs.append(values))
    module.preflight(Client(), '2026-10-20')
    assert outputs[-1]['action'] == 'RUN'
    batches = outputs[-1]['matrix']['include']
    assert len(batches) == 2
    assert sorted(','.join(row['symbols'] for row in batches).split(',')) == ['S1', 'S2', 'S3', 'S4', 'S5']
    assert writes[0][1][0]['error'] == 'EOD_MISSING_CANDLE'
    session.append({'status': 'INCOMPLETE', 'source_policy': module.SOURCE_POLICY})
    writes.clear()
    module.preflight(Client(), '2026-10-20')
    assert outputs[-1]['action'] == 'DONE'
    assert not writes
