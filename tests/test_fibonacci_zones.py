from datetime import date, timedelta

import httpx
import pytest

from protstock.analysis import resolve_signal
from protstock.config import Settings
from protstock.engines import evaluate_pullback_continuation_v1
from protstock.fibonacci import enrich_pattern_fibonacci, fibonacci_levels, matching_fibonacci
from protstock.supabase_rest import SupabaseRestClient
from protstock.zone_refresh import refresh_zones
from protstock.zones import detect_zones


def swing(timeframe='W'):
    closes = [110, 108, 100, 104, 110, 116, 125, 140, 132, 128, 124, 125, 123, 124]
    return [{"date": (date(2025, 1, 1) + timedelta(days=i * 7)).isoformat(), "open": c - 1, "high": c + 2, "low": c - 2, "close": c, "volume": 100, "is_complete": True} for i, c in enumerate(closes)]


@pytest.mark.parametrize('timeframe', ['W', 'M'])
def test_fibonacci_clear_completed_swing_only(timeframe):
    rows = swing(timeframe)
    levels = fibonacci_levels(rows, timeframe)
    assert [level['ratio'] for level in levels] == [0.382, 0.5, 0.618]
    assert levels[1]['price'] == 120
    assert fibonacci_levels(rows, 'D') == []
    assert fibonacci_levels([{**row, 'high': 102, 'low': 98, 'close': 100} for row in rows], timeframe) == []
    # An uncompleted high cannot be used as the swing anchor.
    assert fibonacci_levels([{**row, 'is_complete': i < 7} for i, row in enumerate(rows)], timeframe) == []
    assert fibonacci_levels(rows + [{**rows[-1], 'low': 90}], timeframe) == []
    assert fibonacci_levels(rows + [{**rows[-1], 'high': 200, 'is_complete': False}], timeframe) == levels


def fib_context():
    return {'levels': fibonacci_levels(swing(), 'W'), 'weekly_averages': {}}


def pattern(state='CONFIRMED', quality=68):
    return {'pattern_type': 'DOUBLE_BOTTOM', 'state': state, 'direction': 'BULLISH', 'quality_score': quality, 'trigger_price': 125, 'invalidation_price': 120, 'reasons': [], 'evidence': {}}


def snapshot():
    return {'close': 125, 'volume_avg20': 3_000_000, 'volume_ratio20': 1.5, 'rsi14': 60, 'trend_state': 'UP', 'ma_stack': False}


def test_fibonacci_bonus_requires_evidence_and_never_confirms_setup():
    context = fib_context()
    support = [{'zone_type': 'SUPPORT', 'lower_price': 119, 'upper_price': 121}]
    assert matching_fibonacci(120, context) == []
    ma_context = {**context, 'weekly_averages': {'ema20': 120}}
    assert matching_fibonacci(120, ma_context)[0]['sources'] == ['W_EMA20']
    ready = pattern('READY')
    assert enrich_pattern_fibonacci(ready, context, support) == ready
    assert resolve_signal([ready], snapshot())[0] == 'WATCH'
    assert resolve_signal([], snapshot())[0] == 'WATCH'
    enriched = enrich_pattern_fibonacci(pattern(), context, support)
    assert enriched['quality_score'] == 72
    assert enrich_pattern_fibonacci(enriched, context, support) == enriched
    assert enrich_pattern_fibonacci(pattern(quality=99), context, support)['quality_score'] == 100
    action, reasons = resolve_signal([enriched], snapshot())
    assert action == 'PROBE_BUY'
    assert 'FIB_CONFLUENCE' in reasons and 'PATTERN_DOUBLE_BOTTOM_CONFIRMED' in reasons
    assert resolve_signal([enriched], {**snapshot(), 'volume_ratio20': 0.5})[0] == 'WATCH'
    assert resolve_signal([enriched], {**snapshot(), 'close': 115}, {'invalidation_price': 120}) == ('EXIT', ['INVALIDATION_BROKEN'])


def zone_bars():
    rows = [{'date': (date(2025, 1, 1) + timedelta(days=i)).isoformat(), 'open': 106, 'high': 112 + i * .01, 'low': 103 + i * .01, 'close': 108, 'volume': 100} for i in range(35)]
    for i in (5, 12, 19, 28):
        rows[i]['low'] = 100
    return rows


def support_zone(rows, context=None):
    return next(z for z in detect_zones(rows, fibonacci_context=context) if z['zone_type'] == 'SUPPORT')


def test_zone_volume_reaction_recency_and_bounds():
    rows = zone_bars()
    base = support_zone(rows)
    heavy = [{**row, 'volume': 300 if i in (5, 12, 19, 28) else 100} for i, row in enumerate(rows)]
    assert support_zone(heavy)['strength'] > base['strength']
    rejected = [{**row, 'close': row['high'] if i in (5, 12, 19, 28) else row['close']} for i, row in enumerate(rows)]
    assert support_zone(rejected)['strength'] > base['strength']
    old = rows + [{**rows[-1], 'date': '2025-02-05', 'low': 104, 'high': 114}]
    assert support_zone(old)['evidence']['components']['recency'] < base['evidence']['components']['recency']
    assert base['touches'] == 4 and base['lower_price'] == pytest.approx(99.7)
    assert support_zone([{**row, 'volume': 0} for row in rows])['evidence']['volume_ratio_at_touches'] is None
    assert all(0 <= z['strength'] <= 100 for z in detect_zones(heavy))
    context = {'levels': [{'price': 100, 'ratio': .5, 'timeframe': 'W'}], 'weekly_averages': {}}
    matched = support_zone(rows, context)
    assert matched['strength'] == pytest.approx(base['strength'] + 4)
    assert matched['evidence']['reasons'] == ['FIB_CONFLUENCE']


def test_zone_start_index_maps_full_history():
    rows = [{**row, 'date': f'2024-{i:03}'} for i, row in enumerate(zone_bars() * 6)]
    zones = detect_zones(rows)
    assert zones and all(z['start_index'] >= len(rows) - 160 for z in zones)


def test_pullback_fibonacci_cannot_bypass_existing_conditions():
    context = {'bars': [{'open': 119, 'close': 120, 'low': 118, 'high': 121}], 'snapshot': {'ema20': 119, 'volume_ratio20': .8}, 'multi_timeframe_context': {'monthly_snapshot': {'trend_state': 'UP'}, 'weekly_snapshot': {'trend_state': 'UP'}}, 'fibonacci_context': fib_context()}
    passed, action, reasons = evaluate_pullback_continuation_v1(context)
    assert passed and action == 'PROBE_BUY' and 'FIB_CONFLUENCE' in reasons
    assert evaluate_pullback_continuation_v1({**context, 'snapshot': {'ema20': 119, 'volume_ratio20': 2}}) == (False, 'WATCH', [])


def test_zone_replacement_upserts_before_deactivating_only_obsolete_bounds():
    calls = []
    def handler(request):
        calls.append((request.method, request.url, request.content))
        if request.method == 'GET':
            return httpx.Response(200, json=[{'id': 'keep', 'zone_type': 'SUPPORT', 'lower_price': 99.7, 'upper_price': 100.3}, {'id': 'old', 'zone_type': 'SUPPORT', 'lower_price': 90, 'upper_price': 91}])
        return httpx.Response(200, json=[{}])
    client = SupabaseRestClient(Settings('https://example.supabase.co', 'test'), transport=httpx.MockTransport(handler))
    try:
        client.replace_zone_snapshot(1, 'D', '2025-01-01', [{'zone_type': 'SUPPORT', 'lower_price': 99.7, 'upper_price': 100.3}])
    finally:
        client.close()
    assert [call[0] for call in calls] == ['GET', 'POST', 'PATCH']
    assert calls[-1][1].params['id'] == 'in.(old)'
    assert calls[-1][1].params['as_of_date'] == 'eq.2025-01-01'
    assert b'false' in calls[-1][2]


def test_refresh_zones_writes_all_timeframes_from_stored_history_only():
    class Client:
        def active_symbols(self): return [{'id': 1, 'symbol': 'TEST'}]
        def price_history(self, symbol_id, limit): return [{**row, 'trading_date': row['date']} for row in zone_bars()]
        def replace_zone_snapshot(self, symbol_id, timeframe, as_of_date, rows):
            written[timeframe] = rows
            return len(rows)
    written = {}
    result = refresh_zones(date(2025, 2, 5), client=Client())
    assert result['symbols'] == 1 and result['failed'] == 0
    assert set(written) == {'D', 'W', 'M'}
    assert written['D'][0]['evidence']['quality_version'] == 'pivot-volume-reaction-v1'
