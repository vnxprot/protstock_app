"""Recover up to 20 closed Radar sessions from verified per-trade history."""
from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor
import csv
from dataclasses import replace
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from functools import partial
import gzip
from itertools import accumulate
import os
from pathlib import Path
from threading import local

from .config import Settings
from .market_radar import (BACKFILL_BUDGET, EXCHANGES, REPORT_BATCH_RESERVE, SOURCE_ERRORS,
                           capture_matches, reconcile_tape, session_dates, storage_used)
from .market_radar_tape import Match, integer, tape_integrity
from .market_sources import VN
from .supabase_rest import SupabaseRestClient

HISTORY_SESSIONS = 20
BOARDS = ('G1', 'G4')
MARKETS = {'HOSE': 'STO', 'HNX': 'STX', 'UPCOM': 'UPX'}
SIDES = {'BUY': 'b', 'SELL': 's', 'UNSPECIFIED': 'unknown', 'ATO': 'ato', 'ATC': 'atc'}
PROBES = (('HOSE', 'OCB'), ('HNX', 'SHS'), ('UPCOM', 'BVB'))


class DNSEHistory:
    def __init__(self):
        self.key = os.getenv('DNSE_API_KEY')
        self.secret = os.getenv('DNSE_API_SECRET')
        self.local = local()
        if not self.key or not self.secret or os.getenv('RADAR_DNSE_APPROVED') != 'true':
            raise ValueError('DNSE requires configured credentials and approved zero-cost use')

    def read(self, day, exchange, symbol):
        if not hasattr(self.local, 'client'):
            from dnse import DNSEClient
            self.local.client = DNSEClient(api_key=self.key, api_secret=self.secret,
                                           base_url='https://openapi.dnse.com.vn', api_version='2026-07-23')
        begin = int(datetime.combine(day, time.min, VN).timestamp())
        boards = {}
        for board in BOARDS:
            matches = {}
            seen_tokens = set()
            token = None
            for _ in range(400):
                status, body = self.local.client.get_trades(symbol=symbol, board_id=board, from_date=begin,
                    to_date=begin + 86_399, limit=100, order='ASC', next_page_token=token)
                if status != 200 or not isinstance(body, dict) or not isinstance(body.get('trades'), list):
                    raise ValueError(f'DNSE historical request failed (HTTP {status}, board {board})')
                for row in body['trades']:
                    stamp = datetime.fromisoformat(row['time'])
                    stamp = stamp.astimezone(VN) if stamp.tzinfo else stamp.replace(tzinfo=VN)
                    if (row['symbol'], row['marketId'], row['boardId'], stamp.date()) != (symbol, MARKETS[exchange], board, day):
                        raise ValueError('DNSE returned mismatched symbol, market, board or date')
                    price = integer(Decimal(str(row['matchPrice'])) * 1000)
                    match = normalized_match(day, exchange, stamp, price, row['matchQtty'], row['totalVolumeTraded'], row['side'], board)
                    if match.cumulative in matches and matches[match.cumulative] != match:
                        raise ValueError('DNSE returned conflicting cumulative volume')
                    matches[match.cumulative] = match
                token = body.get('nextPageToken')
                if not token:
                    break
                if token in seen_tokens:
                    raise ValueError('DNSE pagination did not advance')
                seen_tokens.add(token)
            else:
                raise ValueError('DNSE pagination limit reached')
            boards[board] = list(matches.values())
        return combine_boards(boards, exchange)


def normalized_match(day, exchange, stamp, price, volume, cumulative, side, board):
    if stamp.date() != day or board not in BOARDS:
        raise ValueError('Trade date or matched board is invalid')
    price, volume, cumulative = integer(price), integer(volume), integer(cumulative)
    if not price or not volume or cumulative < volume:
        raise ValueError('Trade price or volume is invalid')
    direction = SIDES[side]
    if exchange == 'HOSE' and time(9) <= stamp.time() <= time(9, 15):
        direction = 'ato'
    return Match(stamp, price, volume, cumulative, direction, board)


def combine_boards(boards, exchange):
    def order(match):
        return match.stamp, match.cumulative, match.board

    merged = sorted((match for board in boards.values() for match in board), key=order)
    if tape_integrity(merged, exchange)[1]:
        return merged
    if not all(tape_integrity(sorted(board, key=order), exchange)[1] for board in boards.values()):
        raise ValueError('Trade cumulative volumes have gaps')
    # Some feeds report cumulative volume separately per board. Validate each before merging.
    cumulative = accumulate(match.volume for match in merged)
    return [replace(match, cumulative=total) for match, total in zip(merged, cumulative)]


def read_csv_day(directory, day):
    path = directory / f'{day}.csv'
    if not path.exists():
        path = path.with_suffix('.csv.gz')
    if not path.exists():
        return {}
    open_file = gzip.open if path.suffix == '.gz' else open
    output = {}
    with open_file(path, 'rt', encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            exchange, symbol, board = row['exchange'], row['symbol'], row['board']
            if exchange not in EXCHANGES:
                raise ValueError('Unknown exchange in trade archive')
            stamp = datetime.fromisoformat(row['timestamp'])
            if stamp.tzinfo is None:
                raise ValueError('Trade archive timestamp requires a timezone')
            match = normalized_match(day, exchange, stamp.astimezone(VN), row['price_vnd'], row['quantity'],
                                     row['cumulative_volume'], row['side'], board)
            entries = output.setdefault((exchange, symbol), {}).setdefault(board, {})
            if match.cumulative in entries and entries[match.cumulative] != match:
                raise ValueError('Trade archive has conflicting cumulative volume')
            entries[match.cumulative] = match
    return {key: {board: list(matches.values()) for board, matches in boards.items()} for key, boards in output.items()}


def candidate(read, source, day, exchange, symbol):
    try:
        tape = read(exchange, symbol)
        if tape is None:
            return None
        rows = reconcile_tape(day, exchange, symbol, capture_matches(tape, exchange), tape_source=source)
        if not rows[0]['partial']:
            return rows
        print(f'{day} {exchange} {symbol}: {rows[0]["tape_reason"]}', flush=True)
    except (*SOURCE_ERRORS, ArithmeticError, OSError) as error:
        print(f'{day} {exchange} {symbol}: {error}', flush=True)
    return None


def completed(db, day):
    methods = {}
    for row in db._pages('market_radar_daily', {'select': 'symbol,exchange,method', 'trading_date': f'eq.{day}',
            'category': 'eq.large', 'partial': 'eq.false', 'reference_volume': 'not.is.null',
            'order': 'exchange,symbol,method'}):
        methods.setdefault((row['exchange'], row['symbol']), set()).add(row['method'])
    return {key for key, values in methods.items() if {'continuous', 'continuous_cluster', 'auction'} <= values}


def backfill(db, days, provider, directory, shard, shards):
    symbols = [row for row in db.active_symbols() if row['exchange'] in EXCHANGES][shard::shards]
    source = 'DNSE LightSpeed' if provider else 'Băng khớp nhập từ CSV'
    with ThreadPoolExecutor(max_workers=3) as pool:
        for day in days:
            if storage_used(db) + REPORT_BATCH_RESERVE >= BACKFILL_BUDGET:
                print(f'::warning::Tape history deferred at {day}: database reserve reached', flush=True)
                return
            ready = completed(db, day)
            wanted = [(row['exchange'], row['symbol']) for row in symbols
                      if (not row['listed_from'] or row['listed_from'] <= day.isoformat())]
            missing = [key for key in wanted if key not in ready]
            files = read_csv_day(directory, day) if directory else {}

            def recover(key):
                def read(exchange, symbol):
                    if provider:
                        return provider.read(day, exchange, symbol)
                    boards = files.get((exchange, symbol))
                    return combine_boards(boards, exchange) if boards is not None else None
                return candidate(read, source, day, *key)

            verified = len(wanted) - len(missing)
            for rows in pool.map(recover, missing):
                if rows is None:
                    continue
                response = db._request('POST', '/rpc/publish_market_radar_tape', json={'p_rows': rows, 'p_fill_only': True})
                response.raise_for_status()
                verified += 1
            print(f'{day} shard {shard}: {verified}/{len(wanted)} mã có băng khớp đã đối soát', flush=True)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--csv-directory', type=Path)
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--end', type=date.fromisoformat)
    parser.add_argument('--shard', type=int, default=0)
    parser.add_argument('--shards', type=int, default=1)
    args = parser.parse_args()
    if not 0 <= args.shard < args.shards or (args.csv_directory and (args.probe or not args.csv_directory.is_dir())):
        parser.error('Expected a valid shard and a directory of daily CSV archives, or a DNSE probe')
    now = datetime.now(VN)
    closed = now.date() if now.time() >= time(16, 30) else now.date() - timedelta(days=1)
    db = SupabaseRestClient(Settings.from_env())
    days = [day for day in session_dates(db, closed, HISTORY_SESSIONS) if not args.end or day <= args.end]
    if not days:
        parser.error('No closed sessions in the VNINDEX calendar')
    provider = None if args.csv_directory else DNSEHistory()
    if args.probe:
        verified = 0
        for day in dict.fromkeys((days[-1], days[0])):
            for exchange, symbol in PROBES:
                rows = candidate(partial(provider.read, day), 'DNSE LightSpeed', day, exchange, symbol)
                if rows and any((row['buy_count'] or row['sell_count']) for row in rows if row['method'] == 'continuous'):
                    verified += 1
                    print(f'{day} {exchange} {symbol}: verified {rows[0]["reference_volume"]:,} shares', flush=True)
        print(f'DNSE probe: {verified}/{len(set((days[-1], days[0]))) * len(PROBES)} samples verified', flush=True)
        if not verified:
            raise SystemExit('DNSE has no verified historical sample')
        return
    backfill(db, days, provider, args.csv_directory, args.shard, args.shards)


if __name__ == '__main__':
    main()
