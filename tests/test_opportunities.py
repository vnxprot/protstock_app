from copy import deepcopy
from datetime import date, datetime, timedelta
import httpx
import pytest

from protstock.opportunities import assess, telegram_text
from protstock import opportunities


def stock():
    day = date(2026, 10, 20)
    prices = [{'trading_date': (day-timedelta(days=24-i)).isoformat(), 'open': 13, 'high': 13.4,
               'low': 12.7, 'close': 13, 'volume': 7_000_000, 'quality_status': 'VALID'} for i in range(25)]
    prices[-1].update(close=13.4, volume=6_865_100)
    return {'symbol_id': 77, 'symbol': 'VSC', 'sector': 'CANG BIEN', 'prices': prices,
        'technical': [{'as_of_date': '2026-10-19', 'close': 13.1, 'ema20': 13.15, 'macd_histogram': .04},
                      {'as_of_date': '2026-10-20', 'close': 13.4, 'ema20': 13.17, 'macd_histogram': .067,
                       'rsi14': 52.2, 'volume_avg20': 7_113_795, 'volume_ratio20': .965, 'cmf20': -.23,
                       'atr14': .4, 'monthly_context': {'state': 'DOWN'}}],
        'bursts': [{'id': 1, 'direction': 'UP', 'start_time': '14:10', 'end_time': '14:29',
                    'volume': 2_998_000, 'value_vnd': 39_604_615_000, 'price_change_pct': 2.308, 'baseline_sessions': 30}],
        'minute_status': {'status': 'COMPLETE', 'baseline_sessions': 30}, 'signals': []}


def test_recovery_with_late_burst_is_visible_despite_monthly_down_without_invented_buy():
    row = assess([stock()], '2026-10-20')[0]
    assert row['status'] == 'PRIORITY'
    assert row['system_action'] == 'WATCH'
    assert row['invalidation_price'] is None and row['trigger_price'] is None
    assert row['evidence']['up_burst_share_pct'] == 43.67
    assert 'Xu hướng tháng còn giảm' in row['risks']


def test_missing_minute_coverage_cannot_contribute_burst_confirmation():
    item = stock()
    item['minute_status']['status'] = 'PARTIAL'
    row = assess([item], '2026-10-20')[0]
    assert row['status'] == 'OBSERVE' and not row['burst']


def test_system_exit_outranks_positive_evidence_and_never_notifies_as_opportunity():
    item = stock()
    item['signals'] = [{'composite_action': 'EXIT'}]
    row = assess([item], '2026-10-20')[0]
    assert row['status'] == 'RISK' and not row['notify']


def test_stale_candle_and_impossible_merged_volume_are_not_priority():
    item = stock()
    item['prices'][-1]['trading_date'] = '2026-10-19'
    assert assess([item], '2026-10-20') == []
    item = stock()
    item['bursts'] *= 3
    assert not assess([item], '2026-10-20')[0]['burst']


def test_unchanged_recovery_without_new_burst_is_not_notified_again():
    item = stock()
    item['bursts'] = []
    previous = assess([deepcopy(item)], '2026-10-20')
    assert previous[0]['notify']
    row = assess([item], '2026-10-20', previous)[0]
    assert row['change'] == 'CONTINUED' and not row['notify']


def test_telegram_pins_the_exact_publication_and_calls_it_research():
    rows = assess([stock()], '2026-10-20')
    text = telegram_text({'date': '2026-10-20', 'publication_id': '11111111-1111-4111-8111-111111111111'}, rows)
    assert 'date=2026-10-20&publication=11111111-1111-4111-8111-111111111111&symbol=VSC' in text
    assert 'chưa phải tín hiệu mua' in text and len(text) < 3900


def test_historical_notification_is_suppressed_before_accessing_credentials_or_database():
    assert opportunities.notify(None, {'date': '2000-01-01'})['status'] == 'HISTORICAL_OR_OUTSIDE_WINDOW'


def test_duplicate_claim_never_sends_to_telegram(monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 20, 17, 30, tzinfo=opportunities.VN).astimezone(tz or opportunities.VN)
    class Rest:
        def post(self, *args, **kwargs):
            return httpx.Response(409, request=httpx.Request('POST', 'https://example.org/claim'))
    class Client:
        _client = Rest()
        def _pages(self, table, params):
            return [{'user_id': 'owner'}] if table == 'user_profiles' else [{'enabled': True, 'scope': 'ALL', 'max_symbols': 5}]
    monkeypatch.setattr(opportunities, 'datetime', Clock)
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN', 'test')
    monkeypatch.setenv('TELEGRAM_CHAT_ID', 'test')
    def unexpected(*args, **kwargs):
        raise AssertionError('Duplicate claim must not contact Telegram')
    monkeypatch.setattr(opportunities.httpx, 'post', unexpected)
    result = opportunities.notify(Client(), {'date': '2026-10-20', 'publication_id': 'fixed', 'rows': assess([stock()], '2026-10-20')})
    assert result['status'] == 'ALREADY_CLAIMED'


def test_duplicate_stock_fails_instead_of_creating_multiple_ranks():
    with pytest.raises(ValueError, match='Duplicate symbol'):
        assess([stock(), stock()], '2026-10-20')


def test_eod_preview_does_not_claim_missing_minute_data_or_send_a_digest():
    item = stock()
    item['bursts'], item['minute_status'] = [], {}
    row = assess([item], '2026-10-20', minutes_checked=False)[0]
    assert row['status'] == 'OBSERVE'
    assert 'Danh sách EOD sơ bộ, chưa đối chiếu Radar' in row['risks']
    assert opportunities.notify(None, {'phase': 'EOD'})['status'] == 'PROVISIONAL_NOT_SENT'


def test_rpc_records_database_error_and_retries_only_safe_reads(monkeypatch):
    class Rest:
        calls = 0
        def post(self, path, json):
            self.calls += 1
            return httpx.Response(500, json={'code': '57014', 'message': 'statement timeout'},
                                  request=httpx.Request('POST', 'https://example.org' + path))
    class Client:
        _client = Rest()
    client = Client()
    monkeypatch.setattr(opportunities, 'sleep', lambda _: None)
    with pytest.raises(RuntimeError, match='57014.*statement timeout'):
        opportunities.rpc(client, 'opportunity_input_batch', {})
    assert client._client.calls == 2
    with pytest.raises(RuntimeError):
        opportunities.rpc(client, 'begin_opportunity_build', {})
    assert client._client.calls == 3


def test_failed_batch_still_publishes_explicit_partial_preview(monkeypatch):
    item = stock()
    ids = list(range(1, 51))
    saved = []
    def rpc(client, name, payload):
        if name == 'begin_opportunity_build':
            return {'action': 'RUN', 'token': 'owned'}
        if name == 'opportunity_input_batch':
            if payload['p_ids'][0] == 1:
                raise RuntimeError('one failed batch')
            return [{**deepcopy(item), 'symbol_id': i, 'symbol': f'S{i}'} for i in payload['p_ids']]
        assert name == 'finish_opportunity_build'
        saved.append(payload)
        return 'partial-id'
    class Rest:
        def patch(self, *args, **kwargs):
            return httpx.Response(204, request=httpx.Request('PATCH', 'https://example.org/build'))
    class Client:
        _client = Rest()
    monkeypatch.setattr(opportunities, 'rpc', rpc)
    result = opportunities._build_phase(Client(), {'eod': {'finished_at': 'eod', 'source_revision': 'rev'},
        'radar': {'published_at': 'radar'}, 'symbol_ids': ids}, date(2026, 10, 20), 'RADAR', True)
    assert result['status'] == 'PROVISIONAL' and result['build_failed']
    assert saved[0]['p_summary']['processed_symbols'] == 25
    assert saved[0]['p_summary']['failed_symbol_ids'] == list(range(1, 26))
    assert opportunities.notify(None, result)['status'] == 'PROVISIONAL_NOT_SENT'


def test_eod_success_remains_visible_when_radar_build_fails(monkeypatch):
    monkeypatch.setattr(opportunities, 'rpc', lambda *args: {'eod': {'finished_at': 'eod', 'counts': {'publication_status': 'COMPLETE'}},
                                                           'radar': {'status': 'PUBLISHED', 'published_at': 'radar'}})
    def build(client, inputs, day, phase, historical):
        if phase == 'RADAR':
            raise RuntimeError('radar unavailable')
        return {'status': 'PROVISIONAL', 'date': day.isoformat(), 'rows': [stock()]}
    monkeypatch.setattr(opportunities, '_build_phase', build)
    result = opportunities.publish(None, date(2026, 10, 20))
    assert result['status'] == 'PROVISIONAL' and result['build_failed']


def test_history_failure_does_not_block_latest_sessions(monkeypatch):
    calls = []
    class Client:
        _client = type('Rest', (), {})()
        def close(self):
            pass
    def publish(client, day, **kwargs):
        calls.append(day.isoformat())
        if day == date(2026, 10, 14):
            raise RuntimeError('isolated historical error')
        return {'status': 'PUBLISHED', 'date': day.isoformat(), 'rows': []}
    monkeypatch.setattr(opportunities.Settings, 'from_env', lambda: None)
    monkeypatch.setattr(opportunities, 'SupabaseRestClient', lambda _: Client())
    monkeypatch.setattr(opportunities, 'publish', publish)
    monkeypatch.setattr('sys.argv', ['opportunities', '--start-date', '2026-10-14', '--end-date', '2026-10-21'])
    with pytest.raises(RuntimeError, match='remaining dates'):
        opportunities.main()
    assert calls[:2] == ['2026-10-20', '2026-10-21']
    assert '2026-10-19' in calls and calls[-2:] == ['2026-10-20', '2026-10-21']
