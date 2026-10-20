import httpx
import pytest

from protstock import market_http


def test_public_http_retries_rate_limit_without_sdk(monkeypatch):
    responses = [httpx.Response(429, request=httpx.Request("GET", "https://vendor.test")),
                 httpx.Response(200, json={"ok": True}, request=httpx.Request("GET", "https://vendor.test"))]
    waits = []
    monkeypatch.setattr(market_http.httpx, "request", lambda *_args, **_kwargs: responses.pop(0))
    monkeypatch.setattr(market_http, "sleep", waits.append)
    assert market_http.request_json("GET", "https://vendor.test") == {"ok": True}
    assert 65 in waits


def test_public_http_does_not_retry_permanent_source_refusal(monkeypatch):
    calls = []
    def request(*args, **kwargs):
        calls.append(kwargs["headers"])
        return httpx.Response(403, request=httpx.Request("GET", "https://vendor.test"))
    monkeypatch.setattr(market_http.httpx, "request", request)
    monkeypatch.setattr(market_http, "sleep", lambda *_: None)
    with pytest.raises(market_http.SourceUnavailable, match="HTTP=403"):
        market_http.request_json("GET", "https://vendor.test")
    assert len(calls) == 1 and "Authorization" not in calls[0]
