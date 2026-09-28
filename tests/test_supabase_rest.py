import httpx

from protstock.config import Settings
from protstock.supabase_rest import SupabaseRestClient


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
