from copy import deepcopy
from datetime import date, timedelta

import httpx
import pytest

from protstock.signal_policy import apply_signal_policy, average_turnover_vnd
from protstock.eod import _write_analysis, _decision_context, _initialize_engine_stats, _load_portfolios
from protstock.divergence import evaluate_rsi_macd_confirmation
from protstock.period_signals import monthly_trend, evaluate_period_signal
from protstock.supabase_rest import SupabaseRestClient
from protstock.config import Settings


def context():
    return {"snapshot": {"close": 20, "volume_avg20": 1_000_000, "atr14": 1}, "evaluation_date": "2026-09-15", "data_date": "2026-09-15", "market_context": {"breadth": {"pct_above_sma50": 60}, "vnindex_snapshot": {"trend_state": "UP"}}, "multi_timeframe_context": {"monthly_snapshot": {"trend_state": "UP"}}, "engine_evidence": {"invalidation_price": 18}}


def test_turnover_converts_thousand_vnd_exactly_once():
    assert average_turnover_vnd({"close": 7.39, "volume_avg20": 1_353_980}) == pytest.approx(10_005_912_200)
    assert apply_signal_policy("PROBE_BUY", [], context())[0] == "PROBE_BUY"


def test_degraded_breadth_is_recorded_without_blocking_a_valid_entry():
    ctx = context()
    ctx["market_context"]["breadth"]["coverage_status"] = "DEGRADED"
    action, reasons = apply_signal_policy("PROBE_BUY", [], ctx)
    assert action == "PROBE_BUY"
    assert "BREADTH_DATA_DEGRADED" in reasons


@pytest.mark.parametrize("action", ["PROBE_BUY", "ADD"])
def test_common_policy_blocks_bad_regime(action):
    ctx = context()
    ctx["market_context"]["vnindex_snapshot"]["trend_state"] = "DOWN"
    result, reasons = apply_signal_policy(action, [], ctx)
    assert result == "WATCH" and "ENTRY_BLOCKED" in reasons and "VNINDEX_DOWNTREND" in reasons


def test_exit_preempts_entry_filters_and_reduce_requires_holding():
    ctx = context()
    ctx.update(position={"invalidation_price": 21}, market_context=None)
    assert apply_signal_policy("PROBE_BUY", [], ctx)[0] == "EXIT"
    ctx["position"] = None
    assert apply_signal_policy("REDUCE", [], ctx) == ("WATCH", ["NO_OPEN_POSITION"])


def test_sizing_in_vnd_uses_capital_denominator_and_existing_sector():
    ctx = context()
    ctx.update(capital=100_000_000, candidate_sector="BDS", portfolio_positions=[{"quantity": 1500, "market_price": 20_000, "sector": "BDS"}])
    action, reasons = apply_signal_policy("PROBE_BUY", [], ctx)
    assert action == "WATCH" and "SECTOR_CONCENTRATION_LIMIT" in reasons
    assert ctx["engine_evidence"]["sizing"]["quantity"] == 500
    assert ctx["engine_evidence"]["sizing"]["projected_sector_weight_pct"] == 40
    ctx["candidate_sector"] = "BANK"
    assert apply_signal_policy("PROBE_BUY", [], ctx)[0] == "PROBE_BUY"


@pytest.mark.parametrize("key,value,code", [("data_date","2026-09-14","STALE_PRICE_DATA"),("portfolio_error","unavailable","PORTFOLIO_CONTEXT_UNAVAILABLE"),("market_context",None,"MARKET_CONTEXT_MISSING")])
def test_missing_or_stale_context_fails_closed(key,value,code):
    ctx = context(); ctx[key] = value
    action, reasons = apply_signal_policy("PROBE_BUY", [], ctx)
    assert action == "WATCH" and code in reasons


class Recorder:
    def __init__(self): self.tables = {}
    def upsert(self, table, rows, conflict): self.tables[table] = list(rows); return len(rows)
    def delete_consolidated_signal(self, *args): pass


@pytest.mark.parametrize("engine", ["core_ladder_v1", "core_ladder_v2", "classical_patterns_v0", "pullback_continuation_v1", "vcp_breakout_v1", "rsi_macd_confirmation_v1_1", "relative_strength_leader_v1", "custom"])
def test_every_proposal_passes_policy_before_storage(monkeypatch, engine):
    monkeypatch.setattr("protstock.eod.evaluate_named_engine", lambda *args: (True, "PROBE_BUY", ["TEST_SETUP"]))
    ctx = context(); ctx["market_context"]["vnindex_snapshot"]["trend_state"] = "DOWN"
    ctx["monthly_snapshot"] = {"trend_state": "UP"}
    result = {"as_of_date": "2026-09-15", "patterns": [], "zones": [], "indicators": ctx["snapshot"]}
    client = Recorder()
    _write_analysis(client, 1, "D", [{"date":"2026-09-15"}], [], [{"id":"v", "dsl":{"engine":engine}, "rules":{"kind":"CORE_PACK"}}], {"signals":0}, result, ctx, persist_evidence=False)
    assert client.tables["signals"][0]["action"] == "WATCH"
    assert client.tables["consolidated_signals"][0]["composite_action"] == "WATCH"
    evaluation = client.tables["signal_evaluations"][0]
    assert evaluation["proposed_action"] == "PROBE_BUY"
    assert "VNINDEX_DOWNTREND" in evaluation["reasons"]


def test_only_latest_rule_version_executes():
    def handler(request):
        if request.url.path.endswith('/rules'): return httpx.Response(200,json=[{"id":"r","name":"RSI","status":"ACTIVE"}])
        assert request.url.params['order'] == 'version.desc'
        return httpx.Response(200,json=[{"id":"new","rule_id":"r","version":2,"dsl":{}},{"id":"old","rule_id":"r","version":1,"dsl":{}}])
    client=SupabaseRestClient(Settings('https://example.org','key'),transport=httpx.MockTransport(handler))
    assert [row['id'] for row in client.active_rule_versions()] == ['new']
    client.close()


def bars(count=55):
    return [{"date": (date(2026,1,1)+timedelta(days=i)).isoformat(),"open":100,"close":100,"high":105,"low":99,"volume":1000} for i in range(count)]


def divergence_context(monkeypatch, cross=True):
    rows=bars();rows[20]['low']=95;rows[35]['low']=90
    rows[-1].update(close=106,high=107)
    def indicators(prefix):
        i=len(prefix)-1
        data={"rsi14":25 if i==20 else 35 if i==35 else 45,"macd_histogram":1 if cross and i>=42 else -1}
        class Snapshot:
            def to_dict(self):return data
        return Snapshot()
    monkeypatch.setattr('protstock.divergence.momentum_series',lambda rows: [indicators(rows[:i+1]).to_dict() for i in range(len(rows))])
    return {"bars":rows,"zones":[{"zone_type":"SUPPORT","strength":70,"lower_price":89,"upper_price":96}]}


def test_rsi_macd_requires_both_macd_and_fixed_price_trigger(monkeypatch):
    ctx=divergence_context(monkeypatch)
    assert evaluate_rsi_macd_confirmation(ctx)[:2] == (True,'PROBE_BUY')
    assert ctx['engine_evidence']['trigger_price']==105
    assert ctx['engine_evidence']['setup_confirmed_on']==ctx['bars'][37]['date']
    ctx['bars'][-1]['close']=104
    assert evaluate_rsi_macd_confirmation(ctx)[:2] == (True,'WATCH')
    ctx=divergence_context(monkeypatch,cross=False)
    assert 'WAIT_MACD_CONFIRMATION' in evaluate_rsi_macd_confirmation(ctx)[2]


def test_divergence_no_lookahead_invalidation_expiry_and_no_repeat(monkeypatch):
    ctx=divergence_context(monkeypatch)
    ctx['bars']=ctx['bars'][:37]
    assert evaluate_rsi_macd_confirmation(ctx)[0] is False
    ctx=divergence_context(monkeypatch); ctx['bars'][40]['close']=89
    assert evaluate_rsi_macd_confirmation(ctx)[2]==['RSI_SETUP_INVALIDATED']
    ctx=divergence_context(monkeypatch); ctx['bars'][-2]['close']=106
    assert evaluate_rsi_macd_confirmation(ctx)[0] is False
    ctx=divergence_context(monkeypatch); ctx['bars'] += bars(10)
    assert evaluate_rsi_macd_confirmation(ctx)[0] is False


def test_monthly_uses_twenty_closed_months_not_daily_ma50():
    rows=[{**bar,'close':10+i} for i,bar in enumerate(bars(20))]
    assert monthly_trend(rows)['trend_state']=='UP'
    assert monthly_trend(rows[:-1])['trend_state']=='UNKNOWN'
    ctx={'bars':[{**r,'is_complete':True} for r in rows], 'period_event':True,'evaluation_date':'2026-09-01'}
    assert evaluate_period_signal('M',ctx)[:2]==(True,'WATCH')
    assert 'MONTHLY_TREND_CHANGED_UP' in evaluate_period_signal('M',ctx)[2]


def test_weekly_ignores_developing_bar_and_requires_period_event():
    rows=[{**bar,'is_complete':True} for bar in bars(21)]
    rows[-1].update(close=110,volume=2000)
    ctx={'bars':rows+[{'is_complete':False}], 'period_event':True,'evaluation_date':'2026-09-14'}
    assert evaluate_period_signal('W',ctx)[:2]==(True,'PROBE_BUY')
    ctx['period_event']=False
    assert evaluate_period_signal('W',ctx)[0] is False


def test_calendar_confirmation_occurs_on_first_observed_next_period():
    rows=[{**bars(1)[0],'date':day} for day in ('2026-09-10','2026-09-11','2026-09-14')]
    assert _decision_context(rows,date(2026,9,14),{})['period_events']['W'] is True
    assert _decision_context(rows[:-1],date(2026,9,11),{})['period_events']['W'] is False


def test_stats_separate_day_week_month():
    stats=_initialize_engine_stats([{'id':'v','dsl':{'timeframes':['D','W','M']},'rules':{'id':'r'}}])
    assert {row['timeframe'] for row in stats.values()}=={'D','W','M'}


def test_momentum_series_matches_existing_indicators_and_is_prefix_stable():
    from protstock.divergence import momentum_series
    from protstock.indicators import calculate_indicators
    rows=[{**bar,'close':100+(i%7)-i*.1} for i,bar in enumerate(bars(80))]
    series=momentum_series(rows)
    for i in range(15,80):
        expected=calculate_indicators(rows[:i+1])
        assert series[i]['rsi14']==pytest.approx(expected.rsi14)
        if expected.macd_histogram is None: assert series[i]['macd_histogram'] is None
        else: assert series[i]['macd_histogram']==pytest.approx(expected.macd_histogram)
    assert momentum_series(rows[:60])==series[:60]


def test_weekly_event_reaches_consolidated_with_confirmation_date():
    rows=[{**bar,'is_complete':True} for bar in bars(21)]
    rows[-1].update(close=110,volume=2000)
    ctx=context();ctx.update(period_events={'W':True},monthly_snapshot={'trend_state':'UP'},evaluation_date='2026-09-15')
    result={'as_of_date':'2026-09-11','patterns':[],'zones':[],'indicators':{'close':110,'volume_avg20':1_000_000,'atr14':2}}
    client=Recorder()
    _write_analysis(client,1,'W',rows,[],[{'id':'v','dsl':{'engine':'core_ladder_v2','timeframes':['D','W','M']},'rules':{}}],{'signals':0},result,ctx,persist_evidence=False)
    row=client.tables['consolidated_signals'][0]
    assert row['timeframe']=='W' and row['as_of_date']=='2026-09-15'
    assert row['composite_action']=='PROBE_BUY'


def test_weekly_pullback_evidence_is_not_mislabeled_as_breakout():
    rows=[{**bar,'is_complete':True} for bar in bars(21)]
    rows[-1].update(close=102,open=100,low=99)
    ctx={'bars':rows,'period_event':True,'evaluation_date':'2026-09-14'}
    assert evaluate_period_signal('W',ctx)[:2]==(True,'WATCH')
    assert ctx['engine_evidence']['pattern_type']=='WEEKLY_PULLBACK_EMA20'


def test_classical_flat_base_and_accumulation_share_evidence_family():
    from protstock.eod import _pattern_evidence_cluster
    assert _pattern_evidence_cluster(['V0_FLAT_BASE_BREAKOUT_CONFIRMED']) == _pattern_evidence_cluster(['PATTERN_ACCUMULATION_BASE_CONFIRMED'])
