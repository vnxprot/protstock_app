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
