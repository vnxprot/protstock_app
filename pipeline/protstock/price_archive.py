"""Private, checksummed OHLCV history stored by symbol."""
import gzip
import hashlib
import json

from .research_archive import BUCKET, check_storage_budget


def object_name(symbol_id, checksum):
    return f"ohlcv/vci/{int(symbol_id)}/{checksum}.json.gz"


def read_prices(client, symbol_id, checksum):
    response = client.get(f"/storage/v1/object/authenticated/{BUCKET}/{object_name(symbol_id, checksum)}")
    response.raise_for_status()
    if hashlib.sha256(response.content).hexdigest() != checksum:
        raise RuntimeError(f"Price archive checksum mismatch for {symbol_id}")
    return json.loads(gzip.decompress(response.content))


def archive_prices(client, symbol_id, rows, previous=None):
    content = gzip.compress(json.dumps(rows, sort_keys=True, separators=(",", ":"), default=str).encode(), mtime=0)
    checksum = hashlib.sha256(content).hexdigest()
    if checksum != previous:
        check_storage_budget(client, len(content))
        client.post(f"/storage/v1/object/{BUCKET}/{object_name(symbol_id, checksum)}", content=content,
                    headers={"Content-Type": "application/gzip", "x-upsert": "true"}).raise_for_status()
    read_prices(client, symbol_id, checksum)
    return checksum


def remove_previous(client, symbol_id, old, current):
    if old and old != current:
        response = client.delete(f"/storage/v1/object/{BUCKET}/{object_name(symbol_id, old)}")
        if response.status_code not in (200, 204, 404):
            print(f"::warning::Old OHLCV archive cleanup deferred for symbol {symbol_id} (HTTP {response.status_code})")
