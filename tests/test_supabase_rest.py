import httpx
import json

from protstock.config import Settings
from protstock.supabase_rest import SupabaseRestClient


def test_rebuild_cleanup_identifies_only_superseded_rule_outputs() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        client.remove_superseded_rule_outputs(7, "D", "2026-10-09", ["vcp-id", "macd-id"],
                                              [{"rule_version_id": "macd-id", "action": "WATCH"}],
                                              [{"rule_version_id": "macd-id"}])
        assert requests[0].url.path == "/rest/v1/rpc/remove_superseded_rule_outputs"
        payload = json.loads(requests[0].content)
        assert payload["p_rule_version_ids"] == ["vcp-id", "macd-id"]
        assert payload["p_signal_keys"] == ["macd-id:WATCH"]
        assert payload["p_evaluation_ids"] == ["macd-id"]
    finally:
        client.close()


def test_active_rule_versions_uses_explicit_active_rule_query() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/rest/v1/rules":
            return httpx.Response(200, json=[{"id": "rule-v2", "name": "Prot Core Engine v2.0", "kind": "CORE_PACK", "status": "ACTIVE"}])
        if request.url.path == "/rest/v1/rule_versions":
            return httpx.Response(200, json=[{"id": "version-v2", "rule_id": "rule-v2", "dsl": {"engine": "core_ladder_v2"}}])
        return httpx.Response(404)

    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        assert client.active_rule_versions() == [{"id": "version-v2", "dsl": {"engine": "core_ladder_v2"}, "rules": {"id": "rule-v2", "name": "Prot Core Engine v2.0", "kind": "CORE_PACK", "status": "ACTIVE"}}]
        assert requests[0].url.params["status"] == "eq.ACTIVE"
        assert requests[1].url.params["rule_id"] == "in.(rule-v2)"
    finally:
        client.close()


def test_published_signal_count_uses_exact_database_total_not_upserts() -> None:
    from datetime import date

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["as_of_date"] == "eq.2026-09-25"
        assert request.headers["prefer"] == "count=exact"
        return httpx.Response(206, headers={"Content-Range": "0-0/18"}, json=[{"id": "first"}])

    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        assert client.consolidated_signal_count(date(2026, 9, 25)) == 18
    finally:
        client.close()


def test_market_history_pages_benchmark_and_preserves_date_bounds() -> None:
    from datetime import date

    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.params.get_list("trading_date") == ["gte.2021-01-01", "lte.2026-09-28"]
        return httpx.Response(200, json=[{"trading_date": "2021-01-01", "close": 100}] * (1000 if len(requests) == 1 else 1))

    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        rows = client.index_prices_in_range(1, date(2021, 1, 1), date(2026, 9, 28))
        assert len(rows) == 1001
        assert [request.headers["range"] for request in requests] == ["0-999", "1000-1999"]
    finally:
        client.close()


def test_market_history_prices_reset_pagination_each_month() -> None:
    from datetime import date

    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        month = request.url.params.get_list("trading_date")
        if month == ["gte.2026-01-30", "lte.2026-01-31"]:
            return httpx.Response(200, json=[{"trading_date": "2026-01-30"}] *
                                  (1000 if request.headers["range"] == "0-999" else 1))
        assert month == ["gte.2026-02-01", "lte.2026-02-02"]
        return httpx.Response(200, json=[{"trading_date": "2026-02-02"}])

    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        rows = client.all_daily_prices(date(2026, 1, 30), date(2026, 2, 2))
        assert len(rows) == 1002
        assert [request.headers["range"] for request in requests] == ["0-999", "1000-1999", "0-999"]
    finally:
        client.close()


def test_published_signal_dates_only_include_completed_publications() -> None:
    from datetime import date

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["status"] == "eq.SUCCEEDED"
        return httpx.Response(200, json=[
            {"trading_date": "2026-09-25", "counts": {"published_signals": 0}},
            {"trading_date": "2026-09-28", "counts": {"signals": 23}},
        ])

    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        assert client.published_signal_dates(date(2026, 9, 1), date(2026, 9, 30)) == {date(2026, 9, 25)}
    finally:
        client.close()


def test_pattern_snapshot_removes_only_superseded_same_day_geometry() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=[
                {"id": "old", "pattern_type": "BULL_FLAG", "start_date": "2026-07-06", "algorithm_version": "core-rules-v2"},
                {"id": "new", "pattern_type": "BULL_FLAG", "start_date": "2026-08-01", "algorithm_version": "core-rules-v2"},
            ])
        return httpx.Response(204)

    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    row = {"pattern_type": "BULL_FLAG", "start_date": "2026-08-01", "algorithm_version": "core-rules-v2"}
    try:
        assert client.replace_pattern_snapshot(1, "W", "2026-09-25", [row]) == 1
        deletes = [request for request in requests if request.method == "DELETE"]
        assert len(deletes) == 1
        assert deletes[0].url.params["symbol_id"] == "eq.1"
        assert deletes[0].url.params["timeframe"] == "eq.W"
        assert deletes[0].url.params["as_of_date"] == "eq.2026-09-25"
        assert deletes[0].url.params["id"] == "in.(old)"
    finally:
        client.close()


def test_read_retries_timeout_and_transient_503(monkeypatch) -> None:
    monkeypatch.setattr("protstock.supabase_rest.sleep", lambda _: None)
    calls = []
    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadTimeout("temporary", request=request)
        return httpx.Response(503 if len(calls) == 2 else 200, json=[])
    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        assert client.active_symbols() == []
        assert len(calls) == 3
    finally:
        client.close()


def test_queue_claim_is_never_retried_after_timeout():
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.path == "/rest/v1/rpc/claim_backtest_jobs"
        raise httpx.ReadTimeout("unknown claim outcome", request=request)
    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        import pytest
        with pytest.raises(httpx.ReadTimeout):
            client.queued_backtests()
        assert len(calls) == 1
    finally:
        client.close()


def test_breadth_history_pages_keep_point_in_time_bounds():
    from datetime import date
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.params["trading_date"] == "gte.2021-01-01"
        assert request.url.params["and"] == "(trading_date.lte.2026-10-02)"
        assert request.url.params["order"] == "trading_date.asc"
        return httpx.Response(200, json=[{"trading_date": "2021-01-01"}] * (1000 if len(calls) == 1 else 2))
    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        assert len(client.breadth_history(date(2021, 1, 1), date(2026, 10, 2))) == 1002
        assert [r.headers["range"] for r in calls] == ["0-999", "1000-1999"]
    finally:
        client.close()

def test_backtest_symbol_context_can_read_inactive_historical_instrument():
    def handler(request):
        assert request.url.path == "/rest/v1/symbols"
        assert request.url.params["id"] == "eq.7" and "active" not in request.url.params
        assert "exchange" in request.url.params["select"]
        return httpx.Response(200, json=[{"id": 7, "symbol": "OLD", "exchange": "HNX", "active": False}])
    client = SupabaseRestClient(Settings("https://example.supabase.co", "service"), transport=httpx.MockTransport(handler))
    try:
        assert client.symbol_by_id(7)["exchange"] == "HNX"
    finally:
        client.close()
