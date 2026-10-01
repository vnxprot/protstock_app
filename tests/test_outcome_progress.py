from datetime import date, timedelta

from protstock.outcome_worker import evaluate_pending_outcomes
from protstock.outcomes import evaluate_signal_outcome
from protstock.provider_vnstock import KBS_SOURCE_VERSION


def history():
    return [{"trading_date": (date(2026,1,1)+timedelta(days=i)).isoformat(),"open":100+i,"close":100+i,"low":99+i,"source_version":KBS_SOURCE_VERSION} for i in range(25)]


def test_worker_scores_five_sessions_without_waiting_for_twenty(monkeypatch):
    class Client:
        def signals_missing_outcomes(self, cutoff):
            assert cutoff == date(2026,1,2)
            return [{"id":"s","symbol_id":1,"as_of_date":"2026-01-01","signal_outcomes":[]}]
        def research_price_status(self, *args): return {"coverage_status": "MATCHED", "source_version": KBS_SOURCE_VERSION}
        def research_price_history(self, *args): return history()
        def price_history(self, *args): return history()
        def upsert(self, table, rows, conflict):
            assert [row['horizon_days'] for row in rows] == [5]
            return len(rows)
        def close(self): pass
    monkeypatch.setattr('protstock.outcome_worker.Settings.from_env',lambda: None)
    monkeypatch.setattr('protstock.outcome_worker.SupabaseRestClient',lambda _: Client())
    assert evaluate_pending_outcomes(date(2026,1,7)) == {'signals':1,'outcomes':1,'pending':2}


def test_outcome_requires_exact_signal_date_and_future_sessions():
    signal={'id':'s','as_of_date':'2026-01-01'}
    assert evaluate_signal_outcome(signal,history()[1:],5) is None
    assert evaluate_signal_outcome(signal,history()[:5],5) is None
    assert evaluate_signal_outcome(signal,history()[:6],5)['forward_return_pct'] > 0


def test_worker_skips_existing_horizons_and_caches_symbol_history(monkeypatch):
    calls=[]
    class Client:
        def signals_missing_outcomes(self, cutoff):
            return [{"id":name,"symbol_id":1,"as_of_date":"2026-01-01","signal_outcomes":[{"horizon_days":5},{"horizon_days":10}]} for name in ('a','b')]
        def research_price_status(self, *args): return {"coverage_status": "MATCHED", "source_version": KBS_SOURCE_VERSION}
        def research_price_history(self,*args): calls.append(('research',*args)); return history()
        def price_history(self,*args): calls.append(args); return history()
        def upsert(self, table, rows, conflict):
            assert [row['horizon_days'] for row in rows] == [5,10,20,5,10,20]
            return len(rows)
        def close(self): pass
    monkeypatch.setattr('protstock.outcome_worker.Settings.from_env',lambda: None)
    monkeypatch.setattr('protstock.outcome_worker.SupabaseRestClient',lambda _: Client())
    assert evaluate_pending_outcomes(date(2026,1,25))['outcomes'] == 6
    assert len(calls)==2
