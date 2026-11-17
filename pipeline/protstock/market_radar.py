"""Collect dated public market flow without storing individual trades."""
from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timedelta
from functools import lru_cache
import gzip
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
import ssl

import httpx
import pdfplumber

from .config import Settings
from .market_http import SourceUnavailable, request_json
from .market_radar_tape import classify, integer, read_tape, tape_integrity
from .market_sources import VN
from .supabase_rest import SupabaseRestClient

EXCHANGES = ('HOSE', 'HNX', 'UPCOM')
CAFEF = 'https://cafef.vn/du-lieu/Ajax/PageNew/DataHistory/'
HNX_REPORT = 'https://owa.hnx.vn/ftp///THONGKEGIAODICH//'
HNX_INTERMEDIATE = 'https://secure.globalsign.com/cacert/gsrsaovsslca2018.crt'
HNX_INTERMEDIATE_SHA256 = 'b676ffa3179e8812093a1b5eafee876ae7a6aaf231078dad1bfb21cd2893764a'
SSI_HISTORY = 'https://iboard-api.ssi.com.vn/statistics/company/ssmi/stock-info'
SOURCE_ERRORS = (SourceUnavailable, httpx.HTTPError, ValueError, KeyError, TypeError)
BACKFILL_SESSIONS = 50
BACKFILL_BUDGET = 450_000_000
REPORT_BATCH_RESERVE = 10_000_000
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


@lru_cache(maxsize=1)
def hnx_tls():
    response = httpx.get(HNX_INTERMEDIATE, timeout=15)
    response.raise_for_status()
    if sha256(response.content).hexdigest() != HNX_INTERMEDIATE_SHA256:
        raise SourceUnavailable('Unexpected GlobalSign intermediate certificate')
    context = ssl.create_default_context()
    context.verify_flags &= ~getattr(ssl, 'VERIFY_X509_PARTIAL_CHAIN', 0)
    context.load_verify_locations(cadata=ssl.DER_cert_to_PEM_cert(response.content))
    return context


def hnx_proprietary(day, exchange):
    stamp = day.strftime('%Y%m%d')
    board = 'NY' if exchange == 'HNX' else 'UC'
    url = f'{HNX_REPORT}{stamp}/CP/{stamp}_{board}_Chi_tiet_gd_tu_doanh_theo_ma_ck.pdf'
    response = httpx.get(url, timeout=20, follow_redirects=True, verify=hnx_tls())
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


def cafef_reference(day, exchange, symbol):
    payload = cafef_page('PriceHistory', exchange, day, day, symbol=symbol)
    records = payload['Data']
    if len(records) != 1:
        return None
    row = records[0]
    if row['Symbol'] != symbol or row['Ngay'] != day.strftime('%d/%m/%Y'):
        return None
    # CafeF reports negotiated volume in a separate field, KLThoaThuan.
    return integer(row['KhoiLuongKhopLenh'])


def ssi_reference(day, exchange, symbol):
    formatted = day.strftime('%d/%m/%Y')
    payload = request_json('GET', SSI_HISTORY, params={
        'symbol': symbol, 'page': 1, 'pageSize': 2, 'fromDate': formatted, 'toDate': formatted,
    })
    if not isinstance(payload, dict) or payload.get('code') != 'SUCCESS':
        return None
    records = payload.get('data')
    if not isinstance(records, list) or len(records) != 1:
        return None
    row = records[0]
    if row['symbol'] != symbol or row['tradingDate'] != formatted:
        return None
    return integer(row['totalMatchVol'])


def matched_reference(day, exchange, symbol):
    routes = [('CafeF', cafef_reference), ('SSI iBoard', ssi_reference)]
    if exchange != 'HOSE':
        routes.reverse()
    for source, fetch in routes:
        try:
            volume = fetch(day, exchange, symbol)
            if volume is not None:
                return volume, source
        except SOURCE_ERRORS as error:
            print(f'{symbol} reference {source}: {error}', flush=True)
    return None, None


def capture_tape(day, exchange, symbol):
    try:
        tape = read_tape(day, symbol)
        volume, complete = tape_integrity(tape, exchange)
        return {'volume': volume, 'reason': None if complete else 'incomplete_tape',
                'groups': list(classify(tape, exchange)) if complete else []}
    except SOURCE_ERRORS as error:
        print(f'{symbol} tape: {error}', flush=True)
        return {'volume': 0, 'reason': 'source_unavailable', 'groups': []}


def reconcile_tape(day, exchange, symbol, capture):
    reference, source = matched_reference(day, exchange, symbol)
    volume = capture['volume']
    reason = 'missing_reference' if reference is None else capture['reason'] or (
        ('incomplete_tape' if volume == 0 else 'volume_mismatch') if volume != reference else None)
    result = []
    for method, category, turnover, bucket in (capture['groups'] if not reason else classify([], exchange)):
        values = bucket if reason is None else {}
        label = f'Vietcap · đối soát {source}' if source else 'Vietcap · thiếu tham chiếu'
        row = market_row(day, exchange, symbol, category, method, label,
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


def report_status(db, day, exchange, category, status):
    db.upsert('market_radar_source_status', [{'trading_date': day.isoformat(), 'exchange': exchange,
        'category': category, 'status': status}], 'trading_date,exchange,category')


def collect(db, sessions, completed=frozenset()):
    if not sessions:
        raise ValueError('No trading sessions found')
    symbols = [(row['symbol'], row['exchange']) for row in db.active_symbols() if row['exchange'] in EXCHANGES]
    start, end = min(sessions), max(sessions)
    valid_days = set(sessions)
    jobs = [(hnx_proprietary, (day, exchange)) for day in sessions for exchange in ('HNX', 'UPCOM')
            if (day, exchange, 'proprietary') not in completed]
    jobs.extend((foreign_day, (day, exchange)) for day in sessions for exchange in EXCHANGES
                if (day, exchange, 'foreign') not in completed)
    hose_days = {day for day in valid_days if (day, 'HOSE', 'proprietary') not in completed}
    if hose_days:
        jobs.extend((cafef_proprietary, (symbol, exchange, start, end, hose_days))
                    for symbol, exchange in symbols if exchange == 'HOSE')
    total = 0
    failures = 0
    hose_failed = False
    published = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(function, *args): (function, args) for function, args in jobs}
        for future in as_completed(futures):
            function, args = futures[future]
            category = 'foreign' if function is foreign_day else 'proprietary'
            try:
                rows = future.result()
                if function is foreign_day and not rows:
                    raise SourceUnavailable('Foreign-flow report has no stock rows')
            except SOURCE_ERRORS as error:
                failures += 1
                print(f'{category} {args[:2]}: {error}', flush=True)
                if function is cafef_proprietary:
                    hose_failed = True
                else:
                    report_status(db, args[0], args[1], category, 'failed')
                continue
            if function is not cafef_proprietary:
                save_report(db, args[0], args[1], category, rows)
                report_status(db, args[0], args[1], category, 'ready')
                published += 1
                total += len(rows)
            else:
                total += save(db, rows)
    for day in hose_days:
        report_status(db, day, 'HOSE', 'proprietary', 'failed' if hose_failed else 'ready')
    print(f'Market Flow Radar saved {total} rows across {len(sessions)} sessions. Source failures: {failures}.', flush=True)
    if failures and not (total or published):
        raise SourceUnavailable('No radar data collected from any source')


def storage_used(db, *, prune=False):
    response = db._request('POST', '/rpc/market_radar_storage', json={'p_prune': prune})
    response.raise_for_status()
    return integer(response.json())


def backfill_reports(db, end):
    sessions = session_dates(db, end, BACKFILL_SESSIONS)
    if not sessions:
        return
    params = {'select': 'trading_date,exchange,category', 'trading_date': f'gte.{min(sessions).isoformat()}'}
    completed = set()
    for table, filters in [('market_radar_publications', {'method': 'eq.total'}),
                           ('market_radar_source_status', {'status': 'eq.ready'})]:
        response = db._get(f'/{table}', params={**params, **filters})
        response.raise_for_status()
        completed.update((date.fromisoformat(row['trading_date']), row['exchange'], row['category']) for row in response.json())
    for offset in range(0, len(sessions), 5):
        pending = [day for day in sessions[offset:offset + 5] if any((day, exchange, category) not in completed
                   for exchange in EXCHANGES for category in ('foreign', 'proprietary'))]
        if not pending:
            continue
        size = storage_used(db)
        if size + REPORT_BATCH_RESERVE >= BACKFILL_BUDGET:
            print(f'::warning::Radar backfill deferred: database {size:,} bytes + {REPORT_BATCH_RESERVE:,} reserve, budget {BACKFILL_BUDGET:,}.', flush=True)
            return
        try:
            collect(db, pending, completed)
        except SourceUnavailable as error:
            print(f'::warning::Radar report batch {min(pending)} to {max(pending)}: {error}', flush=True)


def collect_tape(db, day, shard, shards, file=None, stage=None):
    symbols = [row for row in db.active_symbols() if row['exchange'] in EXCHANGES
               and (not row['listed_from'] or row['listed_from'] <= day.isoformat())]
    symbols = symbols[shard::shards]
    captures = {}
    if file and file.is_file():
        with gzip.open(file, 'rt', encoding='utf-8') as stream:
            saved = json.load(stream)
        if saved['day'] == day.isoformat():
            captures = saved['symbols']
    with ThreadPoolExecutor(max_workers=5) as pool:
        if stage != 'reconcile':
            retry = set()
            if captures:
                response = db._get('/market_radar_daily', params={'trading_date': f'eq.{day.isoformat()}',
                    'method': 'eq.continuous', 'category': 'eq.large', 'tape_reason': 'eq.volume_mismatch', 'select': 'symbol'})
                response.raise_for_status()
                retry = {row['symbol'] for row in response.json()}
            futures = {}
            for row in symbols:
                symbol = row['symbol']
                previous = captures.get(symbol)
                if symbol in retry or not previous or not previous['volume'] or previous['reason']:
                    futures[pool.submit(capture_tape, day, row['exchange'], symbol)] = symbol
            for future in as_completed(futures):
                symbol = futures[future]
                candidate = future.result()
                previous = captures.get(symbol)
                if not previous or previous['reason'] or (not candidate['reason'] and candidate['volume'] >= previous['volume']):
                    captures[symbol] = candidate
            if file:
                with gzip.open(file, 'wt', encoding='utf-8') as stream:
                    json.dump({'day': day.isoformat(), 'symbols': captures}, stream, separators=(',', ':'))
        if stage == 'capture':
            return
        verified = 0
        missing = {'volume': 0, 'reason': 'source_unavailable', 'groups': []}
        futures = [pool.submit(reconcile_tape, day, row['exchange'], row['symbol'], captures.get(row['symbol'], missing))
                   for row in symbols]
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
    parser.add_argument('--tape-cache', type=Path)
    parser.add_argument('--tape-stage', choices=('capture', 'reconcile'))
    parser.add_argument('--backfill-reports', action='store_true')
    args = parser.parse_args()
    now = datetime.now(VN)
    latest_closed = now.date() if now.time() >= time(16, 30) else now.date() - timedelta(days=1)
    db = SupabaseRestClient(Settings.from_env())
    if args.tape_date:
        if not 0 <= args.shard < args.shards or args.tape_date > latest_closed:
            parser.error('Expected a valid shard and a closed tape date')
        if session_dates(db, args.tape_date, 1) == [args.tape_date]:
            collect_tape(db, args.tape_date, args.shard, args.shards, args.tape_cache, args.tape_stage)
        else:
            # VNINDEX publication may lag the exchange calendar on a regular weekday.
            if args.tape_date.weekday() < 5:
                collect_tape(db, args.tape_date, args.shard, args.shards, args.tape_cache, args.tape_stage)
        return
    end = min(args.end or latest_closed, latest_closed)
    if args.backfill_reports:
        backfill_reports(db, end)
        return
    sessions = session_dates(db, end, args.sessions)
    if args.end is None:
        storage_used(db, prune=True)
    collect(db, sessions)


if __name__ == '__main__':
    main()
