from protstock.analysis import analyze_bars
from protstock.eod import _write_analysis
from protstock.fibonacci import enrich_pattern_fibonacci


def test_fibonacci_decision_reaches_raw_and_consolidated_storage():
    context = {'levels': [{'timeframe': 'W', 'ratio': .5, 'price': 120}], 'weekly_averages': {'ema20': 120}}
    pattern = {'pattern_type': 'DOUBLE_BOTTOM', 'state': 'CONFIRMED', 'direction': 'BULLISH', 'quality_score': 68, 'trigger_price': 125, 'invalidation_price': 120, 'reasons': [], 'evidence': {}}
    enriched = enrich_pattern_fibonacci(pattern, context, [])
    result = {'as_of_date': '2026-09-14', 'patterns': [enriched], 'zones': [], 'indicators': {'close': 125, 'volume_avg20': 3_000_000, 'volume_ratio20': 1.5, 'rsi14': 60, 'trend_state': 'UP', 'ma_stack': False}, 'fibonacci_context': context}
    class Client:
        def upsert(self, table, rows, conflict):
            stored[table] = rows
            return len(rows)
        def delete_consolidated_signal(self, *args): raise AssertionError('Expected meaningful signal')
    stored = {}
    _write_analysis(Client(), 1, 'D', [{'date': '2026-09-14'}], [], [{'id': 'v2', 'dsl': {'engine': 'core_ladder_v2'}, 'rules': {'kind': 'CORE_PACK'}}], {'signals': 0}, result, {'weekly_patterns': [{'direction': 'BULLISH', 'state': 'READY'}], 'monthly_snapshot': {'trend_state': 'UP'}, 'market_context': {'breadth': {'pct_above_sma50': 60}, 'vnindex_snapshot': {'trend_state': 'UP'}}}, persist_evidence=False)
    raw = stored['signals'][0]
    consolidated = stored['consolidated_signals'][0]
    assert raw['action'] == consolidated['composite_action'] == 'PROBE_BUY'
    assert 'FIB_CONFLUENCE' in raw['reasons'] and 'FIB_CONFLUENCE' in consolidated['reasons']
    assert raw['evidence']['fibonacci'][0]['sources'] == ['W_EMA20']
    assert consolidated['confluence_count'] == 1  # Fibonacci is not a second engine.


def test_analyze_bars_reuses_same_fibonacci_aware_zones(monkeypatch):
    import protstock.analysis as analysis
    context = {'levels': [{'timeframe': 'W', 'ratio': .5, 'price': 120}], 'weekly_averages': {}}
    calls = []
    zone = {'zone_type': 'SUPPORT', 'lower_price': 119, 'upper_price': 121, 'strength': 80}
    def detector(bars, *, fibonacci_context=None):
        calls.append(fibonacci_context)
        return [zone]
    monkeypatch.setattr(analysis, 'detect_zones', detector)
    result = analyze_bars([{'date': '2026-09-14', 'open': 120, 'high': 121, 'low': 119, 'close': 120, 'volume': 100}], fibonacci_context=context)
    assert calls == [context]
    assert result['zones'][0] is zone
    assert result['fibonacci_context'] == context
