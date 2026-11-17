"""Build and publish a short replay archive from verified Vietcap tape."""
from datetime import datetime, time
import gzip
import json
from time import monotonic, sleep
from urllib.parse import quote

import httpx

from .market_http import SourceUnavailable
from .market_radar_tape import TRADE_GROUPS, integer, match_group, phase, tape_page
from .market_sources import VN, local_timestamp
from .research_archive import STORAGE_BUDGET

BUCKET = 'market-radar-minute-replay'
REPLAY_SESSIONS = 5
MAX_OBJECT_BYTES = 32 * 1024


def summarize_minutes(tape, exchange):
    minutes = {}
    for match in tape:
        if phase(exchange, match) != 'continuous' or match.side not in ('b', 's'):
            continue
        value = match.price * match.volume
        stamp = int(match.stamp.replace(second=0, microsecond=0).timestamp())
        group = TRADE_GROUPS.index(match_group(value))
        amounts = minutes.setdefault((stamp, group), [0, 0, 0, 0])
        side = 0 if match.side == 'b' else 1
        amounts[side] += value
        amounts[side + 2] += match.volume
    return [[stamp, group, *amounts] for (stamp, group), amounts in sorted(minutes.items())]


def replay_object(day, exchange, capture, rows):
    start = time(9, 15) if exchange == 'HOSE' else time(9)
    end = time(15) if exchange == 'UPCOM' else time(14, 29)
    opening_mark = int(datetime.combine(day, start, VN).timestamp())
    closing_mark = int(datetime.combine(day, end, VN).timestamp())
    continuous = {row['category']: row for row in rows if row['method'] == 'continuous'}
    unknown = [continuous[group]['unknown_value'] or 0 for group in TRADE_GROUPS]
    unavailable = [continuous[group]['buy_value'] is None for group in TRADE_GROUPS]
    payload = {'start': opening_mark, 'end': closing_mark, 'minutes': capture['minutes'],
               'unknown': unknown, 'unavailable': unavailable}
    return gzip.compress(json.dumps(payload, separators=(',', ':')).encode(), mtime=0)


def storage_url(db):
    return f'{db._settings.supabase_url}/storage/v1/object/{BUCKET}'


def prepare_replay(db, cutoff, universe_size, *, prune):
    if prune:
        response = db._request('POST', '/rpc/market_radar_expired_replays', json={'p_cutoff': cutoff.isoformat()})
        response.raise_for_status()
        expired = response.json()
        for offset in range(0, len(expired), 100):
            db._request('DELETE', storage_url(db), json={'prefixes': expired[offset:offset + 100]}).raise_for_status()
    response = db._request('POST', '/rpc/protstock_storage_bytes', json={})
    response.raise_for_status()
    # Every shard reserves enough for the whole universe, including parallel writers.
    return int(response.json()) + universe_size * MAX_OBJECT_BYTES < STORAGE_BUDGET


def publish_replay(db, day, exchange, symbol, capture, rows):
    content = replay_object(day, exchange, capture, rows)
    if len(content) > MAX_OBJECT_BYTES:
        print(f'::warning::Radar replay exceeds its size limit for {exchange}/{symbol}', flush=True)
        return False
    key = f'{exchange}/{quote(symbol, safe="")}/{day.isoformat()}.json.gz'
    db._request('POST', f'{storage_url(db)}/{key}', content=content,
                headers={'Content-Type': 'application/gzip', 'x-upsert': 'true', 'cache-control': '60'}).raise_for_status()
    return True


def pilot_live():
    """Sample the newest VCI page for four symbols without publishing snapshots."""
    previous = {}
    for sample in range(5):
        started = monotonic()
        now = datetime.now(VN)
        if now.weekday() >= 5 or not (time(9, 15) <= now.time() < time(11, 30) or time(13) <= now.time() < time(14, 30)):
            raise SystemExit('Run the VCI pilot during continuous trading in Vietnam')
        for symbol in ('HDB', 'OCB', 'SHS', 'BVB'):
            try:
                trades = {integer(row['id']): row for row in tape_page(symbol, None)
                          if row['symbol'] == symbol and local_timestamp(row['truncTime']).date() == now.date()}
                if not trades:
                    print(f'{symbol}: no current-session matches', flush=True)
                    continue
                windows = sorted((integer(row['accumulatedVolume']), integer(row['matchVol']),
                                  local_timestamp(row['truncTime'])) for row in trades.values())
                first, first_size, _ = windows[0]
                last, _, stamp = windows[-1]
                prior = previous.get(symbol)
                contiguous = all(right[0] - left[0] == right[1] for left, right in zip(windows, windows[1:]))
                overlaps_prior = prior is None or first - first_size <= prior <= last
                age = round((datetime.now(VN) - stamp).total_seconds())
                print(f'{symbol}: {len(trades)} matches, last={stamp:%H:%M:%S}, age_s={age}, '
                      f'page_contiguous={contiguous}, overlaps_previous={overlaps_prior}', flush=True)
                previous[symbol] = last
            except (SourceUnavailable, httpx.HTTPError, ValueError, KeyError, TypeError) as error:
                print(f'{symbol}: {type(error).__name__}', flush=True)
        if sample < 4:
            sleep(max(0, 60 - (monotonic() - started)))


if __name__ == '__main__':
    pilot_live()
