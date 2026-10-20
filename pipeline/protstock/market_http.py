"""Small, bounded public-market HTTP client; no SDK, registration or paid service."""
from time import monotonic, sleep
from threading import Lock

import httpx


class SourceUnavailable(RuntimeError):
    """A public vendor endpoint is unavailable or has changed its contract."""


_lock = Lock()
_last_request = 0.0


def request_json(method: str, url: str, **kwargs):
    global _last_request
    for attempt in range(3):
        with _lock:
            sleep(max(0, 1.0 - (monotonic() - _last_request)))
            _last_request = monotonic()
        try:
            response = httpx.request(method, url, headers={"Accept": "application/json", "User-Agent": "ProtStock/1.0"},
                                     timeout=40, **kwargs)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            status = error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
            if attempt == 2 or (status is not None and status not in {408, 429, 500, 502, 503, 504}):
                raise SourceUnavailable(f"{url.split('/')[2]}: {type(error).__name__}; HTTP={status}") from error
            sleep(65 if status == 429 else 2 ** attempt)
