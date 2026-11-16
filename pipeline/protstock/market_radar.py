"""Collect dated public market flow without storing individual trades."""
from argparse import ArgumentParser
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re

import httpx
import pdfplumber

from .config import Settings
from .market_http import SourceUnavailable, request_json
from .market_sources import VCI_BASE, VN, local_timestamp
from .supabase_rest import SupabaseRestClient

EXCHANGES = ('HOSE', 'HNX', 'UPCOM')
CAFEF = 'https://cafef.vn/du-lieu/Ajax/PageNew/DataHistory/'
VCI_TAPE = VCI_BASE + '/market-watch/LEData/getAll'
HNX_REPORT = 'https://owa.hnx.vn/ftp///THONGKEGIAODICH//'
TRADE_GROUPS = ('large', 'medium', 'small')
FIELDS = ('buy_value', 'sell_value', 'buy_volume', 'sell_volume', 'unknown_value', 'trade_count',
          'market_value', 'holdings', 'ownership_pct', 'room_remaining')


def integer(value, *, allow_negative=False):
    try:
        number = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError('Expected a numeric field') from error
    if not number.is_finite() or number != number.to_integral_value() or (number < 0 and not allow_negative):
        raise ValueError('Expected an integer field')
    return int(number)


def market_row(day, exchange, symbol, category, method, source, *, partial=False, **values):
    return {'trading_date': day.isoformat(), 'exchange': exchange, 'symbol': symbol,
            'category': category, 'method': method, 'source': source, 'partial': partial,
            **{field: values.get(field) for field in FIELDS}}


def cafef_page(endpoint, exchange, start, end, *, symbol='', page=1):
    payload = request_json('GET', f'{CAFEF}{endpoint}.ashx', params={
        'Symbol': symbol, 'Exchange': exchange, 'StartDate': start.strftime('%m/%d/%Y'),
        'EndDate': end.strftime('%m/%d/%Y'), 'PageIndex': page, 'PageSize': 30,
    })
    if not isinstance(payload, dict) or payload.get('Success') is not True or not isinstance(payload.get('Data'), dict):
        raise SourceUnavailable(f'CafeF {endpoint} {exchange}: invalid response')
    return payload['Data']


def foreign_day(day, exchange):
    """The exchange-level request includes dormant symbols, room and ownership percent."""
    seen = set()
    output = []
    total = None
    for page in range(1, 101):
        payload = cafef_page('GDKhoiNgoai', exchange, day, day, page=page)
        count = integer(payload['TotalCount'])
        records = payload.get('Data')
        total = count if total is None else total
        if not isinstance(records, list) or count != total or len(seen) + len(records) > total:
            raise SourceUnavailable(f'CafeF foreign {exchange}: inconsistent pagination')
        for record in records:
            symbol = record['Symbol']
            if record['Ngay'] != day.strftime('%d/%m/%Y') or symbol in seen:
                raise SourceUnavailable(f'CafeF foreign {exchange}: wrong date or repeated symbol')
            seen.add(symbol)
            if not re.fullmatch(r'[A-Z0-9]{3}', symbol):
                continue
            buy, sell = integer(record['GtMua']), integer(record['GtBan'])
            buy_vol, sell_vol = integer(record['KLMua']), integer(record['KLBan'])
            ownership = record.get('DangSoHuu')
            room = record.get('RoomConLai')
            output.append(market_row(day, exchange, symbol, 'foreign', 'total', 'CafeF',
                buy_value=buy, sell_value=sell, buy_volume=buy_vol, sell_volume=sell_vol,
                ownership_pct=ownership if ownership is not None and 0 <= float(ownership) <= 100 else None,
                room_remaining=integer(room, allow_negative=True) if room is not None else None))
        if len(seen) == total:
            return output
        if not records:
            break
    raise SourceUnavailable(f'CafeF foreign {exchange}: incomplete pagination')


def cafef_proprietary(symbol, exchange, start, end, sessions):
    payload = cafef_page('GDTuDoanh', exchange, start, end, symbol=symbol)
    records = payload['Data']['ListDataTudoanh']
    if integer(payload['TotalCount']) != len(records):
        raise SourceUnavailable(f'CafeF proprietary: incomplete history for {symbol}')
    output = []
    for item in records:
        day = datetime.strptime(item['Date'], '%d/%m/%Y').date()
        if item['Symbol'] != symbol or day not in sessions:
            continue
        output.append(market_row(day, exchange, symbol, 'proprietary', 'total', 'CafeF · Prot Universe',
            partial=True, buy_value=integer(item['GtMua']), sell_value=integer(item['GtBan']),
            buy_volume=integer(item['KLcpMua']), sell_volume=integer(item['KlcpBan'])))
    return output


def hnx_proprietary(day, exchange):
    stamp = day.strftime('%Y%m%d')
    board = 'NY' if exchange == 'HNX' else 'UC'
    url = f'{HNX_REPORT}{stamp}/CP/{stamp}_{board}_Chi_tiet_gd_tu_doanh_theo_ma_ck.pdf'
    response = httpx.get(url, timeout=20, follow_redirects=True)
    response.raise_for_status()
    if not response.content.startswith(b'%PDF-') or len(response.content) > 5_000_000:
        raise SourceUnavailable('HNX report is missing or invalid')
    with pdfplumber.open(BytesIO(response.content)) as pdf:
        content = '\n'.join(page.extract_text() or '' for page in pdf.pages)
    if day.strftime('%d/%m/%Y') not in content or 'CHI TIẾT - GIAO DỊCH TỰ DOANH' not in content:
        raise SourceUnavailable('HNX report title or date changed')
    fields = r'\s+'.join([r'([\d.]+)'] * 6)
    summary = re.findall(rf'^\s*Tổng\s+{fields}\s*$', content, re.MULTILINE)
    rows = re.findall(rf'^\s*\d+\s+([A-Z0-9]{{3,10}})\s+{fields}\s*$', content, re.MULTILINE)
    if len(summary) != 1 or len({row[0] for row in rows}) != len(rows):
        raise SourceUnavailable('HNX report has an ambiguous total or duplicate codes')
    accumulated = [0] * 6
    result = []
    for symbol, *values in rows:
        amounts = [int(value.replace('.', '')) for value in values]
        accumulated = [actual + increment for actual, increment in zip(accumulated, amounts)]
        bv, buy, sv, sell, volume, value = amounts
        if bv + sv != volume or buy + sell != value:
            raise SourceUnavailable(f'HNX report row total mismatch: {symbol}')
        if len(symbol) == 3:
            result.append(market_row(day, exchange, symbol, 'proprietary', 'total', 'SGDCK Hà Nội',
                buy_value=buy, sell_value=sell, buy_volume=bv, sell_volume=sv))
    if accumulated != [int(value.replace('.', '')) for value in summary[0]]:
        raise SourceUnavailable('HNX report totals do not match extracted rows')
    return result


def tape_rows(day, exchange, symbol, records):
    if not isinstance(records, list):
        raise SourceUnavailable('VCI tape contract changed')
    trades = {}
    for item in records:
        stamp = local_timestamp(item['truncTime'])
        if stamp.date() != day:
            continue
        if item['symbol'] != symbol:
            raise ValueError('VCI tape returned another symbol')
        vol = integer(item['matchVol'])
        value = vol * integer(item['matchPrice'])
        cumulative = integer(item['accumulatedVolume'])
        trade = (stamp, vol, value, cumulative, item['matchType'])
        key = integer(item['id'])
        if key in trades and trades[key] != trade:
            raise ValueError('Conflicting VCI trade ID')
        trades[key] = trade
    if not trades:
        return []

    previous = 0
    complete = True
    totals = defaultdict(lambda: dict(buy_value=0, sell_value=0, buy_volume=0, sell_volume=0, unknown_value=0, trade_count=0))
    for stamp, vol, value, cumulative, side in sorted(trades.values(), key=lambda trade: (trade[0], trade[3])):
        complete &= cumulative - previous == vol
        previous = cumulative
        opening = time(9, 15) if exchange == 'HOSE' else time(9)
        closing = time(15) if exchange == 'UPCOM' else time(14, 30)
        afternoon = time(13) <= stamp.time() < closing or (exchange == 'UPCOM' and stamp.time() == closing)
        if not (opening <= stamp.time() <= time(11, 30) or afternoon):
            continue
        if (exchange == 'HOSE' and stamp.time() == opening and side not in ('b', 's')) or side in ('ato', 'atc', 'pt', 'put'):
            continue
        category = 'large' if value >= 1_000_000_000 else 'medium' if value >= 200_000_000 else 'small'
        bucket = totals[category]
        bucket['trade_count'] += 1
        if side in ('b', 's'):
            direction = 'buy' if side == 'b' else 'sell'
            bucket[f'{direction}_value'] += value
            bucket[f'{direction}_volume'] += vol
        else:
            bucket['unknown_value'] += value

    turnover = sum(row['buy_value'] + row['sell_value'] + row['unknown_value'] for row in totals.values())
    result = []
    for category in TRADE_GROUPS:
        bucket = totals[category]
        if bucket['unknown_value'] and not (bucket['buy_volume'] or bucket['sell_volume']):
            bucket.update(buy_value=None, sell_value=None, buy_volume=None, sell_volume=None)
        result.append(market_row(day, exchange, symbol, category, 'continuous', 'Vietcap · Prot Universe',
            partial=not complete, market_value=turnover if complete else None, **bucket))
    return result


def session_dates(db, end, count):
    response = db._get('/market_index_prices', params={
        'select': 'trading_date,market_indices!inner(code)', 'market_indices.code': 'eq.VNINDEX',
        'trading_date': f'lte.{end.isoformat()}', 'order': 'trading_date.desc', 'limit': str(count),
    })
    response.raise_for_status()
    return [date.fromisoformat(row['trading_date']) for row in response.json()]


def save(db, rows):
    return db.upsert('market_radar_daily', rows, 'trading_date,exchange,symbol,category,method')


def save_report(db, day, exchange, category, rows):
    response = db._request('POST', '/rpc/replace_market_radar_report', json={
        'p_day': day.isoformat(), 'p_exchange': exchange, 'p_category': category, 'p_method': 'total', 'p_rows': rows,
    })
    response.raise_for_status()


def collect(db, sessions, *, latest_tape):
    if not sessions:
        raise ValueError('No trading sessions found')
    symbols = [(row['symbol'], row['exchange']) for row in db.active_symbols() if row['exchange'] in EXCHANGES]
    start, end = min(sessions), max(sessions)
    valid_days = set(sessions)
    jobs = [(f'proprietary {exchange} {day}', hnx_proprietary, (day, exchange))
            for day in sessions for exchange in ('HNX', 'UPCOM')]
    jobs.extend((f'foreign {exchange} {day}', foreign_day, (day, exchange)) for day in sessions for exchange in EXCHANGES)
    if latest_tape:
        jobs.extend((f'tape {exchange} {symbol}', fetch_tape, (latest_tape, exchange, symbol)) for symbol, exchange in symbols)
    jobs.extend((f'proprietary {exchange} {symbol}', cafef_proprietary, (symbol, exchange, start, end, valid_days))
                for symbol, exchange in symbols if exchange == 'HOSE')
    total = 0
    failures = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [(label, function, args, pool.submit(function, *args)) for label, function, args in jobs]
        for label, function, args, future in futures:
            try:
                rows = future.result()
            except (SourceUnavailable, httpx.HTTPError, ValueError, KeyError, TypeError) as error:
                failures += 1
                print(f'{label}: {error}', flush=True)
                continue
            if function is hnx_proprietary or (function is foreign_day and rows):
                category = 'foreign' if function is foreign_day else 'proprietary'
                save_report(db, args[0], args[1], category, rows)
                total += len(rows)
            else:
                total += save(db, rows)
    print(f'Market Flow Radar saved {total} rows across {len(sessions)} sessions. Source failures: {failures}.', flush=True)
    if not total:
        raise SourceUnavailable('No radar data collected from any source')


def fetch_tape(day, exchange, symbol):
    def get_page(cursor):
        return request_json('POST', VCI_TAPE, json={'symbol': symbol, 'limit': 100, 'truncTime': cursor})

    records = get_page(None)
    if isinstance(records, list) and records:
        oldest = records[-1]
        # The vendor cursor is exclusive. Include the boundary second and deduplicate by ID.
        if local_timestamp(oldest['truncTime']).date() == day and integer(oldest['accumulatedVolume']) > integer(oldest['matchVol']):
            page = get_page(integer(oldest['truncTime']) + 1)
            if isinstance(page, list):
                records += page
    return tape_rows(day, exchange, symbol, records)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--sessions', type=int, choices=range(1, 21), default=1)
    parser.add_argument('--end', type=date.fromisoformat)
    args = parser.parse_args()
    now = datetime.now(VN)
    latest_closed = now.date() if now.time() >= time(16, 30) else now.date() - timedelta(days=1)
    db = SupabaseRestClient(Settings.from_env())
    end = min(args.end or latest_closed, latest_closed)
    sessions = session_dates(db, end, args.sessions)
    # Vietcap exposes the most recent tape. Its timestamps must match the chosen date.
    # The daily VNINDEX job may still be running when today's tape is available.
    tape_day = end if args.end is None and end.weekday() < 5 else None
    collect(db, sessions, latest_tape=tape_day)


if __name__ == '__main__':
    main()
