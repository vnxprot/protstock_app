"""Read the matched-volume field from SSI FastConnect V3 daily summaries."""
from datetime import date
from functools import lru_cache
import os
from threading import Lock
from time import monotonic, sleep

import httpx

from .market_http import SourceUnavailable
from .market_radar_tape import integer


class SSIReference:
    def __init__(self, key, secret):
        self.client = httpx.Client(base_url='https://api.ssi.com.vn', timeout=15)
        self.credentials = {'apiKey': key, 'apiSecret': secret}
        self.lock = Lock()
        self.token = None
        self.refresh_at = 0

    def authenticate(self):
        with self.lock:
            if monotonic() >= self.refresh_at:
                self.refresh_at = monotonic() + 60
                self.token = None
                response = self.client.post('/api/v3/auth/token', json=self.credentials)
                response.raise_for_status()
                self.token = response.json()['accessToken']
                if self.token:
                    self.refresh_at = monotonic() + 240
            if not self.token:
                raise SourceUnavailable('SSI reference authentication unavailable')
            return self.token

    def matched_volume(self, day, symbol):
        stamp = day.strftime('%Y/%m/%d')
        for attempt in range(2):
            response = self.client.get('/api/v3/data/securitiesSummary',
                params={'symbol': symbol, 'from': stamp, 'to': stamp, 'pageIndex': 1, 'pageSize': 10},
                headers={'Authorization': f'Bearer {self.authenticate()}', 'Content-Type': 'application/json'})
            if attempt == 0 and response.status_code in (429, 502, 503, 504):
                delay = response.headers.get('Retry-After', '')
                sleep(min(int(delay), 15) if delay.isdigit() else 2)
                continue
            response.raise_for_status()
            if response.status_code == 204:
                return None
            payload = response.json()
            records = payload['data']
            if not isinstance(records, list) or int(payload.get('pagesCount') or 0) > 1:
                raise SourceUnavailable('Unexpected SSI reference pagination')
            matches = [row for row in records if row['symbol'].upper() == symbol
                       and date.fromisoformat(str(row['tradingDate'])[:10].replace('/', '-')) == day]
            if len(matches) == 1:
                return integer(matches[0]['totalMatch'])
            return None


@lru_cache(maxsize=1)
def ssi_reference():
    key, secret = os.getenv('SSI_API_KEY'), os.getenv('SSI_API_SECRET')
    return SSIReference(key, secret) if key and secret else None
