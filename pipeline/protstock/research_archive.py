"""Verified private cold storage for vendor research bars (independent of core prices)."""
from __future__ import annotations

from functools import lru_cache
import gzip
import hashlib
import json
from uuid import uuid4

import httpx

BUCKET = "database-archives"
STORAGE_BUDGET = 450_000_000


def check_storage_budget(client: httpx.Client, incoming: int) -> None:
    response = client.post("/rest/v1/rpc/protstock_storage_bytes", json={})
    response.raise_for_status()
    occupied = int(response.json())
    if occupied + incoming >= STORAGE_BUDGET:
        raise RuntimeError(f"Storage budget reached: {occupied:,} existing + {incoming:,} bytes")


class ResearchArchive:
    def __init__(self, url: str, key: str, transport: httpx.BaseTransport | None = None):
        self.client = httpx.Client(base_url=url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=180, transport=transport)

    def close(self):
        self.analysis_payload.cache_clear()
        self.client.close()

    def _get(self, key: str):
        return self.client.get(f"/storage/v1/object/authenticated/{BUCKET}/{key}")

    @lru_cache(maxsize=80)
    def analysis_payload(self, key: str) -> dict:
        if not key.startswith("analysis/v1/"):
            raise ValueError("Invalid analysis archive path")
        response = self._get(key)
        response.raise_for_status()
        if key.rsplit("/", 1)[-1] != hashlib.sha256(response.content).hexdigest() + ".json.gz":
            raise RuntimeError("Analysis archive checksum mismatch")
        return json.loads(gzip.decompress(response.content))

    def _manifest(self, symbol_id: int) -> dict | None:
        response = self._get(f"research/{symbol_id}/latest.json")
        if response.status_code in {400, 404}:
            error = response.json()
            if response.status_code == 404 or str(error.get("statusCode")) == "404" or error.get("error") in {"not_found", "NoSuchKey"}:
                return None
        response.raise_for_status()
        manifest = response.json()
        if not manifest["object"].startswith(f"research/{symbol_id}/versions/"):
            raise ValueError("Invalid research archive manifest")
        return manifest

    def read(self, symbol_id: int) -> list[dict]:
        manifest = self._manifest(symbol_id)
        if manifest is None:
            return []
        data = self._get(manifest["object"])
        data.raise_for_status()
        if hashlib.sha256(data.content).hexdigest() != manifest["sha256"]:
            raise RuntimeError(f"Research archive checksum mismatch for {symbol_id}")
        rows = json.loads(gzip.decompress(data.content))
        if len(rows) != manifest["rows"]:
            raise RuntimeError(f"Research archive row count mismatch for {symbol_id}")
        return rows

    def write(self, symbol_id: int, rows: list[dict]) -> None:
        # Bucket creation is idempotent; a private bucket is required.
        bucket = self.client.get(f"/storage/v1/bucket/{BUCKET}")
        if bucket.status_code == 404:
            created = self.client.post("/storage/v1/bucket", json={"id": BUCKET, "name": BUCKET, "public": False})
            created.raise_for_status()
        else:
            bucket.raise_for_status()
            if bucket.json().get("public") is not False:
                raise RuntimeError("Research archive must be private")
        content = gzip.compress(json.dumps(rows, separators=(",", ":"), default=str).encode(), compresslevel=9, mtime=0)
        checksum = hashlib.sha256(content).hexdigest()
        previous = self._manifest(symbol_id)
        if previous:
            existing = self.read(symbol_id)
            if previous["sha256"] == checksum or existing == json.loads(gzip.decompress(content)):
                return
        check_storage_budget(self.client, len(content) + 1024)
        object_key = f"research/{symbol_id}/versions/{uuid4().hex}.json.gz"
        uploaded = self.client.post(f"/storage/v1/object/{BUCKET}/{object_key}", content=content,
                                   headers={"Content-Type": "application/gzip", "x-upsert": "false"})
        uploaded.raise_for_status()
        downloaded = self._get(object_key)
        downloaded.raise_for_status()
        if hashlib.sha256(downloaded.content).hexdigest() != checksum:
            raise RuntimeError("Research archive upload verification failed")
        manifest = {"object": object_key, "sha256": checksum, "rows": len(rows),
                    "first_date": rows[0]["trading_date"] if rows else None,
                    "last_date": rows[-1]["trading_date"] if rows else None}
        pointer = self.client.post(f"/storage/v1/object/{BUCKET}/research/{symbol_id}/latest.json",
                                  json=manifest, headers={"x-upsert": "true"})
        pointer.raise_for_status()
        verified = self._get(f"research/{symbol_id}/latest.json")
        verified.raise_for_status()
        if verified.json() != manifest:
            raise RuntimeError("Research archive pointer verification failed")
