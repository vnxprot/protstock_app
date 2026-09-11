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
