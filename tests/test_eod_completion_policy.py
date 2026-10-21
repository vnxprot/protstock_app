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


def test_intraday_two_lots_exclude_missing_eod_and_claim_atomically(monkeypatch):
    module = load('intraday_radar_schedule')
    outputs, writes = [], []
    session = []
    def read(client, table, params):
        if table == 'job_runs':
            return [{'status': 'SUCCEEDED', 'finished_at': '2026-10-20T09:00:00Z',
                     'counts': {'publication_status': 'COMPLETE_WITH_MISSING'}}]
        return session if table == 'intraday_radar_sessions' else []
    class Client:
        def __init__(self): self._client = self
        def active_symbols(self): return [{'id': i, 'symbol': f'S{i}'} for i in range(1, 7)]
        def daily_snapshots_for_date(self, day): return [{'symbol_id': i} for i in range(1, 6)]
        def daily_price_symbol_ids(self, day): return set(range(1, 7))
        def post(self, path, json):
            writes.append((path, json))
            class Response:
                is_error = False
                def raise_for_status(self): pass
                def json(self): return {'action': 'RUN', 'attempt': 1}
            return Response()
    monkeypatch.delenv('FORCE_REFRESH', raising=False)
    monkeypatch.setattr(module, 'read', read)
    monkeypatch.setattr(module, 'write_output', lambda **values: outputs.append(values))
    module.preflight(Client(), '2026-10-20')
    assert outputs[-1]['action'] == 'RUN'
    batches = outputs[-1]['matrix']['include']
    assert len(batches) == 2
    assert sorted(','.join(row['symbols'] for row in batches).split(',')) == ['S1', 'S2', 'S3', 'S4', 'S5']
    assert writes[0][0] == '/rpc/begin_intraday_radar_session'
    assert writes[0][1]['p_missing'] == [{'id': 6, 'symbol': 'S6'}]
    session.append({'status': 'PUBLISHED', 'source_policy': module.SOURCE_POLICY})
    writes.clear()
    module.preflight(Client(), '2026-10-20')
    assert outputs[-1]['action'] == 'DONE'
    assert not writes


def test_radar_watchdog_recovers_absent_session_even_when_eod_succeeded(monkeypatch):
    module = load('intraday_radar_schedule')
    outputs = []
    monkeypatch.setattr(module, 'read', lambda client, table, params: [
        {'status': 'SUCCEEDED', 'finished_at': '2026-10-21T09:00:00Z',
         'counts': {'publication_status': 'COMPLETE_WITH_MISSING'}}] if table == 'job_runs' else [])
    monkeypatch.setattr(module, 'write_output', lambda **values: outputs.append(values))
    module.watchdog(None, '2026-10-21')
    assert outputs[-1]['action'] == 'DISPATCH_RADAR'


def test_radar_watchdog_does_not_loop_source_gaps_or_exhausted_attempts(monkeypatch):
    import pytest
    module = load('intraday_radar_schedule')
    session = {'status': 'INCOMPLETE', 'attempt_count': 1}
    def read(client, table, params):
        if table == 'job_runs':
            return [{'status': 'SUCCEEDED', 'finished_at': '2026-10-21T09:00:00Z',
                     'counts': {'publication_status': 'COMPLETE_WITH_MISSING'}}]
        if table == 'intraday_radar_sessions': return [session]
        return [{'symbol_id': 1, 'retryable': False}]
    monkeypatch.setattr(module, 'read', read)
    with pytest.raises(RuntimeError, match='automatic retry suppressed'):
        module.watchdog(None, '2026-10-21')
    session['attempt_count'] = 3
    with pytest.raises(RuntimeError, match='after 3 attempts'):
        module.watchdog(None, '2026-10-21')


def test_radar_watchdog_recovers_technical_failure(monkeypatch):
    module = load('intraday_radar_schedule')
    outputs = []
    def read(client, table, params):
        if table == 'job_runs': return [{'status': 'SUCCEEDED', 'finished_at': '2026-10-21T09:00:00Z', 'counts': {'publication_status': 'COMPLETE'}}]
        if table == 'intraday_radar_sessions': return [{'status': 'FAILED', 'attempt_count': 1}]
        return [{'symbol_id': 1, 'retryable': True}]
    monkeypatch.setattr(module, 'read', read)
    monkeypatch.setattr(module, 'write_output', lambda **values: outputs.append(values))
    module.watchdog(None, '2026-10-21')
    assert outputs[-1]['action'] == 'DISPATCH_RADAR'


def test_radar_finalize_refuses_empty_universe_and_reports_technical_failure(monkeypatch):
    import pytest
    module = load('intraday_radar_schedule')
    writes = []
    expected = [0]
    states = []
    class Response:
        def raise_for_status(self): pass
    class Client:
        def __init__(self): self._client = self
        def active_symbols(self): return [{'id': 1, 'symbol': 'AAA'}]
        def upsert(self, table, rows, key): writes.extend(rows)
        def delete(self, *args, **kwargs): return Response()
    def read(client, table, params):
        if table == 'intraday_radar_sessions': return [{'expected_symbols': expected[0], 'attempt_count': 1}]
        return states
    monkeypatch.setattr(module, 'read', read)
    with pytest.raises(RuntimeError, match='INCOMPLETE'):
        module.finalize(Client(), '2026-10-21')
    assert writes[-1]['status'] == 'INCOMPLETE'
    expected[0] = 1
    states.append({'symbol_id': 1, 'status': 'FAILED', 'baseline_sessions': 0, 'retryable': True, 'error': 'COLLECTOR_NOT_FINISHED'})
    with pytest.raises(RuntimeError, match='FAILED'):
        module.finalize(Client(), '2026-10-21')
    assert writes[-1]['status'] == 'FAILED'
    states[0].update(status='COMPLETE', baseline_sessions=10, retryable=False, error=None)
    module.finalize(Client(), '2026-10-21')
    assert writes[-1]['status'] == 'PUBLISHED'


def test_radar_watchdog_can_recover_failed_finalization_without_refetch(monkeypatch):
    module = load('intraday_radar_schedule')
    outputs = []
    def read(client, table, params):
        if table == 'job_runs': return [{'status': 'SUCCEEDED', 'finished_at': '2026-10-21T09:00:00Z', 'counts': {'publication_status': 'COMPLETE'}}]
        if table == 'intraday_radar_sessions': return [{'status': 'PROCESSING', 'attempt_count': 1, 'expected_symbols': 1, 'updated_at': '2026-10-20T09:00:00Z'}]
        return [{'symbol_id': 1, 'status': 'COMPLETE', 'baseline_sessions': 10, 'retryable': False}]
    monkeypatch.setattr(module, 'read', read)
    monkeypatch.setattr(module, 'write_output', lambda **values: outputs.append(values))
    module.watchdog(None, '2026-10-21')
    assert outputs[-1]['action'] == 'DISPATCH_RADAR'
