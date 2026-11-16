"""Collect dated public market flow without storing individual trades."""
from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timedelta
from io import BytesIO
import re

import httpx
import pdfplumber

from .config import Settings
from .market_http import SourceUnavailable, request_json
from .market_radar_tape import classify, integer, read_tape, tape_quality
from .market_sources import VN
from .supabase_rest import SupabaseRestClient

EXCHANGES = ('HOSE', 'HNX', 'UPCOM')
CAFEF = 'https://cafef.vn/du-lieu/Ajax/PageNew/DataHistory/'
HNX_REPORT = 'https://owa.hnx.vn/ftp///THONGKEGIAODICH//'
FIELDS = ('buy_value', 'sell_value', 'buy_volume', 'sell_volume', 'unknown_value', 'trade_count',
          'market_value', 'holdings', 'ownership_pct', 'room_remaining')
TAPE_FIELDS = ('buy_count', 'sell_count', 'unknown_count', 'unknown_volume', 'tape_volume', 'reference_volume', 'tape_reason', 'auction_breakdown')


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


def matched_reference(day, exchange, symbol):
    payload = cafef_page('PriceHistory', exchange, day, day, symbol=symbol)
    records = payload['Data']
    if len(records) != 1:
        return None
    row = records[0]
    if row['Symbol'] != symbol or row['Ngay'] != day.strftime('%d/%m/%Y'):
        return None
    # CafeF reports negotiated volume in a separate field, KLThoaThuan.
    return integer(row['KhoiLuongKhopLenh'])


def fetch_tape(day, exchange, symbol):
    reference = None
    tape = []
    reason = None
    try:
        reference = matched_reference(day, exchange, symbol)
    except (SourceUnavailable, ValueError, KeyError, TypeError) as error:
        print(f'{symbol} reference: {error}', flush=True)
    if reference:
        try:
            tape = read_tape(day, symbol)
        except (SourceUnavailable, ValueError, KeyError, TypeError) as error:
            reason = 'source_unavailable'
            print(f'{symbol} tape: {error}', flush=True)
    volume, mismatch = tape_quality(tape, exchange, reference)
    reason = reason or mismatch
    result = []
    for method, category, turnover, bucket in classify(tape, exchange):
        values = bucket if reason is None else {}
        row = market_row(day, exchange, symbol, category, method, 'Vietcap · đối soát CafeF',
                         partial=reason is not None, market_value=turnover if reason is None else None, **values)
        metrics = {**values, 'tape_volume': volume, 'reference_volume': reference, 'tape_reason': reason}
        result.append({**row, **{field: metrics.get(field) for field in TAPE_FIELDS}})
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


def collect(db, sessions):
    if not sessions:
        raise ValueError('No trading sessions found')
    symbols = [(row['symbol'], row['exchange']) for row in db.active_symbols() if row['exchange'] in EXCHANGES]
    start, end = min(sessions), max(sessions)
    valid_days = set(sessions)
    jobs = [(f'proprietary {exchange} {day}', hnx_proprietary, (day, exchange))
            for day in sessions for exchange in ('HNX', 'UPCOM')]
    jobs.extend((f'foreign {exchange} {day}', foreign_day, (day, exchange)) for day in sessions for exchange in EXCHANGES)
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


def collect_tape(db, day, shard, shards):
    symbols = [row for row in db.active_symbols() if row['exchange'] in EXCHANGES
               and (not row['listed_from'] or row['listed_from'] <= day.isoformat())]
    symbols = symbols[shard::shards]
    verified = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(fetch_tape, day, row['exchange'], row['symbol']) for row in symbols]
        for future in as_completed(futures):
            rows = future.result()
            response = db._request('POST', '/rpc/publish_market_radar_tape', json={'p_rows': rows})
            response.raise_for_status()
            verified += int(not rows[0]['partial'])
    print(f'Tape {day} shard {shard}: {verified}/{len(symbols)} freshly verified', flush=True)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--sessions', type=int, choices=range(1, 21), default=1)
    parser.add_argument('--end', type=date.fromisoformat)
    parser.add_argument('--tape-date', type=date.fromisoformat)
    parser.add_argument('--shard', type=int, default=0)
    parser.add_argument('--shards', type=int, default=1)
    args = parser.parse_args()
    now = datetime.now(VN)
    latest_closed = now.date() if now.time() >= time(16, 30) else now.date() - timedelta(days=1)
    db = SupabaseRestClient(Settings.from_env())
    if args.tape_date:
        if not 0 <= args.shard < args.shards or args.tape_date > latest_closed:
            parser.error('Expected a valid shard and a closed tape date')
        if session_dates(db, args.tape_date, 1) == [args.tape_date]:
            collect_tape(db, args.tape_date, args.shard, args.shards)
        else:
            # VNINDEX publication may lag the exchange calendar on a regular weekday.
            if args.tape_date.weekday() < 5:
                collect_tape(db, args.tape_date, args.shard, args.shards)
        return
    end = min(args.end or latest_closed, latest_closed)
    sessions = session_dates(db, end, args.sessions)
    collect(db, sessions)


if __name__ == '__main__':
    main()
