"""Read and reconcile a Vietcap stock tape before classifying matched trades."""
from dataclasses import dataclass, replace
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from itertools import groupby

from .market_http import SourceUnavailable, request_json
from .market_sources import VCI_BASE, VN, local_timestamp

TRADE_GROUPS = ('large', 'medium', 'small')
TAPE_METHODS = ('continuous', 'continuous_cluster', 'auction')
VCI_TAPE = VCI_BASE + '/market-watch/LEData/getAll'
MAX_TAPE_PAGES = 240


def integer(value, *, allow_negative=False):
    try:
        number = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError('Expected a numeric field') from error
    if not number.is_finite() or number != number.to_integral_value() or (number < 0 and not allow_negative):
        raise ValueError('Expected an integer field')
    return int(number)


@dataclass(frozen=True)
class Match:
    stamp: datetime
    price: int
    volume: int
    cumulative: int
    side: str


def tape_page(symbol, cursor):
    result = request_json('POST', VCI_TAPE, json={'symbol': symbol, 'limit': 100, 'truncTime': cursor})
    if not isinstance(result, list):
        raise SourceUnavailable('VCI tape contract changed')
    return result


def read_tape(day, symbol):
    trades = {}
    page = tape_page(symbol, None)
    if page and local_timestamp(page[0]['truncTime']).date() > day:
        boundary = datetime.combine(day + timedelta(days=1), time.min, VN)
        page = tape_page(symbol, int(boundary.timestamp()))
    oldest_seen = None
    for page_number in range(MAX_TAPE_PAGES):
        page_trades = []
        for item in page:
            stamp = local_timestamp(item['truncTime'])
            if stamp.date() != day:
                continue
            if item['symbol'] != symbol:
                raise ValueError('VCI tape returned another symbol')
            match = Match(stamp, integer(item['matchPrice']), integer(item['matchVol']),
                          integer(item['accumulatedVolume']), str(item['matchType']).lower())
            if not match.price or not match.volume:
                raise ValueError('VCI tape returned a zero price or quantity')
            trade_id = integer(item['id'])
            if trade_id in trades and trades[trade_id] != match:
                raise ValueError('Conflicting VCI trade ID')
            trades[trade_id] = match
            page_trades.append(match)
        if not page_trades:
            break
        oldest = min(page_trades, key=lambda match: (match.stamp, match.cumulative))
        if oldest.cumulative == oldest.volume:
            break
        cursor = int(oldest.stamp.timestamp()) + 1
        if oldest_seen is not None and cursor >= oldest_seen:
            break
        oldest_seen = cursor
        if page_number + 1 < MAX_TAPE_PAGES:
            page = tape_page(symbol, cursor)
    return sorted(trades.values(), key=lambda match: (match.stamp, match.cumulative))


def phase(exchange, match):
    at = match.stamp.time()
    if match.side in ('pt', 'put', 'putthrough'):
        return 'negotiated'
    open_at = time(9, 15) if exchange == 'HOSE' else time(9)
    if match.side in ('ato', 'atc') or (exchange == 'HOSE' and time(9) <= at <= open_at and match.side not in ('b', 's')):
        return 'auction'
    if exchange != 'UPCOM' and time(14, 30) <= at <= time(14, 45):
        return 'auction'
    afternoon = time(13) <= at <= time(15) if exchange == 'UPCOM' else time(13) <= at < time(14, 30)
    if open_at <= at <= time(11, 30) or afternoon:
        return 'continuous'
    return 'other'


def tape_quality(tape, exchange, reference_volume):
    previous = 0
    chain_complete = True
    for match in tape:
        chain_complete &= match.cumulative - previous == match.volume
        previous = match.cumulative
    volume = sum(match.volume for match in tape if phase(exchange, match) != 'negotiated')
    if reference_volume is None:
        return volume, 'missing_reference'
    if not chain_complete or volume != reference_volume:
        return volume, 'incomplete_tape' if not chain_complete else 'volume_mismatch'
    return volume, None


def clusters(exchange, tape):
    def cluster_key(match):
        scope = phase(exchange, match)
        if scope == 'continuous' and match.side in ('b', 's'):
            return match.stamp.replace(microsecond=0), match.price, match.side
        return None

    for key, matches in groupby(tape, cluster_key):
        if key is None:
            yield from (match for match in matches if phase(exchange, match) == 'continuous')
        else:
            first = next(matches)
            yield replace(first, volume=first.volume + sum(match.volume for match in matches))


def classify(tape, exchange):
    scopes = {
        'continuous': (match for match in tape if phase(exchange, match) == 'continuous'),
        'continuous_cluster': clusters(exchange, tape),
        'auction': (match for match in tape if phase(exchange, match) == 'auction'),
    }
    for method, matches in scopes.items():
        totals = {group: {f'{side}_{field}': 0 for side in ('buy', 'sell', 'unknown')
                          for field in ('count', 'value', 'volume')} for group in TRADE_GROUPS}
        breakdown = {group: {} for group in TRADE_GROUPS}
        for match in matches:
            value = match.price * match.volume
            group = 'large' if value >= 1_000_000_000 else 'medium' if value >= 200_000_000 else 'small'
            side = {'b': 'buy', 's': 'sell'}.get(match.side, 'unknown') if method != 'auction' else 'unknown'
            totals[group][f'{side}_count'] += 1
            totals[group][f'{side}_volume'] += match.volume
            totals[group][f'{side}_value'] += value
            if method == 'auction':
                at = match.stamp.time()
                if match.side == 'ato' or (exchange == 'HOSE' and time(9) <= at <= time(9, 15)):
                    session = 'opening'
                elif match.side == 'atc' or (exchange != 'UPCOM' and time(14, 30) <= at <= time(14, 45)):
                    session = 'closing'
                else:
                    session = 'other'
                batch = breakdown[group].setdefault(session, dict(count=0, volume=0, value=0))
                batch['count'] += 1
                batch['volume'] += match.volume
                batch['value'] += value
        turnover = sum(bucket[f'{side}_value'] for bucket in totals.values() for side in ('buy', 'sell', 'unknown'))
        for group, bucket in totals.items():
            bucket['trade_count'] = sum(bucket[f'{side}_count'] for side in ('buy', 'sell', 'unknown'))
            if bucket['unknown_count'] and not (bucket['buy_count'] or bucket['sell_count']):
                bucket.update(buy_value=None, sell_value=None, buy_volume=None, sell_volume=None)
            if method == 'auction':
                bucket['auction_breakdown'] = breakdown[group]
            yield method, group, turnover, bucket
