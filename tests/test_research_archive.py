import json

import httpx
import pytest

from protstock.research_archive import ResearchArchive


def archive_with_store(corrupt=False):
    objects = {}
    def handle(request):
        key = request.url.path.split("/database-archives/")[-1]
        if "/bucket/" in request.url.path:
            return httpx.Response(200, json={"public": False})
        if request.method == "POST":
            objects[key] = request.content
            return httpx.Response(200, json={})
        if key not in objects:
            return httpx.Response(404, json={})
        return httpx.Response(200, content=b"corrupt" if corrupt and key.endswith(".gz") else objects[key])
    return ResearchArchive("https://example.test", "test-key", transport=httpx.MockTransport(handle)), objects


def test_verified_research_object_preserves_vendor_prices_and_manifest():
    archive, objects = archive_with_store()
    rows = [{"trading_date": "2026-10-19", "close": 19.25, "volume": 3500, "source": "KBS_PUBLIC"}]
    archive.write(7, rows)
    assert archive.read(7) == rows
    manifest = json.loads(objects["research/7/latest.json"])
    assert manifest["rows"] == 1 and manifest["first_date"] == "2026-10-19"
    archive.close()


def test_failed_upload_verification_does_not_publish_a_pointer():
    archive, objects = archive_with_store(corrupt=True)
    with pytest.raises(RuntimeError, match="verification"):
        archive.write(7, [{"trading_date": "2026-10-19"}])
    assert "research/7/latest.json" not in objects
    archive.close()
