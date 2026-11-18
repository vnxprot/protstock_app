"""Read-only FastConnect Market Data with bounded requests."""
from datetime import date
from functools import lru_cache
from io import BytesIO
import os
from threading import Lock
from time import monotonic, sleep
from urllib.parse import urljoin, urlsplit

import httpx

from .market_http import SourceUnavailable

BASE_URL = 'https://api.ssi.com.vn'


def configured():
    return bool(os.getenv('SSI_API_KEY') and os.getenv('SSI_API_SECRET'))


def ssi_date(value):
    return date.fromisoformat(str(value)[:10].replace('/', '-'))


class MarketData:
    def __init__(self):
        self.client = httpx.Client(base_url=BASE_URL, timeout=30)
        self.lock = Lock()
        self.token = ''
        self.refresh_at = 0

    def _token(self):
        if not configured():
            raise SourceUnavailable('SSI Market Data credentials are unavailable')
        with self.lock:
            if monotonic() >= self.refresh_at:
                try:
                    response = self.client.post('/api/v3/auth/token', json={
                        'apiKey': os.environ['SSI_API_KEY'], 'apiSecret': os.environ['SSI_API_SECRET'],
                    })
                    response.raise_for_status()
                    self.token = response.json()['accessToken']
                except (httpx.HTTPError, ValueError, KeyError) as error:
                    raise SourceUnavailable(f'SSI authentication: {type(error).__name__}') from None
                if not self.token:
                    raise SourceUnavailable('SSI authentication returned an empty token')
                self.refresh_at = monotonic() + 240
            return self.token

    def _get(self, path, params=None, *, token=None):
        path = urljoin(BASE_URL, path)
        address = urlsplit(path)
        if address.scheme != 'https' or address.netloc != 'api.ssi.com.vn':
            raise SourceUnavailable('Unexpected SSI Market Data download host')
        for attempt in range(2):
            try:
                response = self.client.get(path, params=params, headers={
                    'Authorization': f'Bearer {token or self._token()}', 'Content-Type': 'application/json',
                })
                if attempt == 0 and response.status_code in (429, 502, 503, 504):
                    retry = response.headers.get('Retry-After', '')
                    if retry.isdigit() and int(retry) > 30:
                        break
                    sleep(int(retry) if retry.isdigit() else 2)
                    continue
                response.raise_for_status()
                return response
            except httpx.HTTPStatusError as error:
                raise SourceUnavailable(f'SSI Market Data HTTP {error.response.status_code}') from None
            except httpx.RequestError as error:
                if attempt:
                    raise SourceUnavailable(f'SSI Market Data: {type(error).__name__}') from None
        raise SourceUnavailable('SSI Market Data rate limit')

    def _pages(self, endpoint, params):
        for page in range(1, 201):
            result = self._get(f'/api/v3/data/{endpoint}', {**params, 'pageIndex': page, 'pageSize': 100})
            if result.status_code == 204:
                return
            payload = result.json()
            records = payload['data']
            if not isinstance(records, list):
                raise SourceUnavailable(f'Invalid SSI {endpoint} response')
            yield from records
            pages = payload.get('pagesCount')
            if (pages and page >= int(pages)) or not records or (pages is None and len(records) < int(payload.get('pageSize') or 100)):
                return
        raise SourceUnavailable(f'SSI {endpoint} pagination limit')

    def summaries(self, symbol, start, end):
        return {ssi_date(row['tradingDate']): row
                for row in self._pages('securitiesSummary', {'symbol': symbol, 'from': start.strftime('%Y/%m/%d'), 'to': end.strftime('%Y/%m/%d')})
                if row['symbol'] == symbol and start <= ssi_date(row['tradingDate']) <= end}

    def directory(self):
        records = []
        for exchange in ('HOSE', 'HNX', 'UPCOM'):
            rows = self._get('/api/v3/data/securitiesByBoard', {'board': exchange}).json()
            if not isinstance(rows, list) or not rows:
                raise SourceUnavailable(f'Missing SSI directory for {exchange}')
            records.extend({'symbol': row['symbol'].upper(), 'exchange': exchange,
                            'company_name': row.get('symbolNameVi') or row.get('symbolNameEn')}
                           for row in rows if row['board'].upper() == exchange)
        return records

    def corporate_actions(self, start, end):
        return list(self._pages('corporateActions', {
            'from': start.strftime('%Y/%m/%d'), 'to': end.strftime('%Y/%m/%d'), 'language': 'vn',
        }))

    def candles(self, symbol, start, end, *, minute=False):
        pattern = '%Y/%m/%d'
        return list(self._pages('ohlc', {
            'symbol': symbol, 'from': start.strftime(pattern) + (' 00:00:00' if minute else ''),
            'to': end.strftime(pattern) + (' 23:59:59' if minute else ''), 'timeFrame': '1m' if minute else '1d',
        }))

    def _file_rows(self, params, *, expect_one=False):
        from pyarrow.parquet import read_table

        token = self._token()
        files = self._get('/api/v3/data/file', params, token=token).json()['files']
        if expect_one and len(files) != 1:
            raise SourceUnavailable('Expected one SSI daily file')
        for item in files:
            response = self._get(item['dataLink'], token=token)
            try:
                yield from read_table(BytesIO(response.content), columns=[
                    'symbol', 'tradingDate', 'open', 'high', 'low', 'close', 'volume',
                ]).to_pylist()
            except (ValueError, OSError):
                raise SourceUnavailable('Invalid SSI Parquet data') from None

    def daily_file(self, symbol):
        return list(self._file_rows({'symbol': symbol, 'timeFrame': '1d'}, expect_one=True))

    def minute_history(self, symbol, start, end):
        rows = list(self._file_rows({'symbol': symbol, 'timeFrame': '1m',
                                     'fromDate': start.strftime('%Y/%m/%d'), 'toDate': end.strftime('%Y/%m/%d')})) if start < end else []
        if not any(ssi_date(row['tradingDate']) == end for row in rows):
            rows.extend(self.candles(symbol, end, end, minute=True))
        return rows


@lru_cache(maxsize=1)
def market_data():
    return MarketData()
