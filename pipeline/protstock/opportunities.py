"""Research shortlist only: closed EOD + published minute evidence, never orders."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from time import monotonic, sleep
from urllib.parse import urlencode

import httpx

from .config import Settings, vietnam_today
from .supabase_rest import SupabaseRestClient

VERSION = 'NEXT_SESSION_V2'
VN = timezone(timedelta(hours=7))


def number(value, default=0.0):
    return float(value) if value is not None else default


def assess(stocks: list[dict], day: str, previous: list[dict] | None = None, diagnostics: dict | None = None, minutes_checked: bool = True) -> list[dict]:
    """Frozen initial hypotheses; scores express priority, never win probability."""
    prior = {int(r['symbol_id']): r for r in previous or []}
    output = []
    seen = set()
    audit = diagnostics if diagnostics is not None else {}
    def count(reason):
        audit[reason] = audit.get(reason, 0) + 1
    for stock in stocks:
        if stock['symbol_id'] in seen:
            raise ValueError('Duplicate symbol in opportunity input')
        seen.add(stock['symbol_id'])
        count('input_symbols')
        history = stock.get('technical') or []
        prices = stock.get('prices') or []
        if len(history) < 2 or len(prices) < 21:
            count('insufficient_history')
            continue
        t, p = history[-1], history[-2]
        bar = prices[-1]
        if t['as_of_date'] != day or bar['trading_date'] != day or bar['quality_status'] != 'VALID':
            count('stale_or_invalid_price')
            continue
        close = number(t.get('close'))
        if close <= 0 or number(bar.get('volume')) <= 0:
            count('invalid_price_or_volume')
            continue
        turnover = close * number(t.get('volume_avg20')) * 1000
        if turnover < 3_000_000_000:
            count('below_turnover_floor')
            continue
        old = prior.get(int(stock['symbol_id']))
        span = number(bar['high']) - number(bar['low'])
        clv = (close - number(bar['low'])) / span if span > 0 else 0
        crosses = [right['as_of_date'] for left, right in zip(history, history[1:])
                   if left.get('ema20') is not None and right.get('ema20') is not None
                   and number(left['close']) <= number(left['ema20']) and number(right['close']) > number(right['ema20'])]
        recovery = (bool(crosses) and close > number(t.get('ema20'), float('inf'))
                    and 45 <= number(t.get('rsi14')) <= 65 and clv >= .75
                    and t.get('macd_histogram') is not None and p.get('macd_histogram') is not None
                    and number(t['macd_histogram']) > number(p['macd_histogram']))
        minute = stock.get('minute_status') or {}
        minute_ok = minute.get('status') == 'COMPLETE' and number(minute.get('baseline_sessions')) >= 10
        events = stock.get('bursts') or []
        up = [b for b in events if minute_ok and b['direction'] == 'UP'
              and number(b['price_change_pct']) >= .5 and number(b['value_vnd']) >= 1_000_000_000
              and number(b['baseline_sessions']) >= 10]
        up_volume = sum(number(b['volume']) for b in up)
        up_value = sum(number(b['value_vnd']) for b in up)
        share = up_volume / number(bar['volume'])
        # Merged events must be non-overlapping; refuse impossible sums rather than cap them.
        burst = bool(up) and share <= 1.02 and (share >= .15 or up_value >= 5_000_000_000) and clv >= .6
        late = any(b['start_time'] >= '14:00' for b in up)
        signals = stock.get('signals') or []
        action = next((a for a in ('EXIT', 'REDUCE', 'ADD', 'PROBE_BUY')
                       if any(s['composite_action'] == a for s in signals)), 'WATCH')
        setups = [s for s in signals if s.get('signal_state') == 'WATCH_SETUP' or s['composite_action'] in ('ADD', 'PROBE_BUY')]
        funnel = stock.get('funnel') or {}
        macd = stock.get('macd') or {}
        momentum = stock.get('momentum') or {}
        setup = (bool(setups) or funnel.get('stage') in ('WEEKLY_READY', 'DAILY_TRIGGER')
                 or macd.get('stage') == 'WATCH_PRICE_CONFIRMATION'
                 or macd.get('stage') == 'CONFIRMED' and macd.get('trigger_date') == day)
        active_momentum = momentum.get('stage') in ('SURGE_WATCH','DAILY_BREAKOUT','WEEKLY_CONFIRMED','REACCELERATING')
        first = old.get('first_seen', day) if old and old.get('status') != 'INVALIDATED' else day
        age = sum(b['trading_date'] > first for b in prices)
        if old and age > 5 and (recovery or burst or setup or active_momentum):
            first, age, old = day, 0, None
        carried = bool(old) and old.get('status') not in ('INVALIDATED', 'RISK') and age <= 6
        if not (recovery or burst or setup or active_momentum or carried):
            count('no_matching_evidence')
            continue
        support = min(number(b['low']) for b in prices[-10:])
        stop = next((number(s['invalidation_price']) for s in setups if s.get('invalidation_price') and 0 < number(s['invalidation_price']) < close), None)
        trigger = next((number(s['trigger_price']) for s in setups if s.get('trigger_price')), None)
        monthly = (t.get('monthly_context') or {}).get('state') or (momentum.get('evidence') or {}).get('monthly_state') or 'UNKNOWN'
        change_pct = (close / number(p['close']) - 1) * 100 if number(p['close']) > 0 else 0
        atr = number(t.get('atr14'))
        extended = (change_pct >= 5 or momentum.get('entry_status') == 'EXTENDED'
                    or atr > 0 and t.get('ema20') is not None and close - number(t['ema20']) > 2 * atr)
        invalid = carried and (age > 5 or close < number(old.get('support_reference')) or
                              old.get('invalidation_price') is not None and close < number(old['invalidation_price']))
        status = ('RISK' if action in ('EXIT', 'REDUCE') else 'INVALIDATED' if invalid
                  else 'EXTENDED' if extended else 'PRIORITY' if burst and (recovery or setup) else 'OBSERVE')
        reasons = []
        if recovery:
            reasons.append('Hồi phục: vượt EMA20, RSI 45–65, động lượng cải thiện')
        if burst:
            reasons.append(('Cụm tăng cuối phiên' if late else 'Cụm giao dịch tăng') + f' · {up_value / 1e9:.2f} tỷ · {share * 100:.1f}% KL ngày')
        if setup:
            reasons.append('Có setup từ tín hiệu hệ thống, Phễu hoặc MACD')
        if active_momentum:
            reasons.append('Radar đà tăng đang có diễn biến mới')
        if not reasons:
            reasons.append('Tiếp tục theo dõi bằng chứng của phiên trước')
        risks = []
        if monthly == 'DOWN':
            risks.append('Xu hướng tháng còn giảm')
        if number(t.get('cmf20')) < 0:
            risks.append('CMF20 còn âm')
        if not minute_ok:
            risks.append('Chưa đủ nến phút hoặc lịch sử so sánh cho mã này' if minutes_checked else 'Danh sách EOD sơ bộ, chưa đối chiếu Radar')
        if not stop:
            risks.append('Điểm vào và stop chưa được hệ thống xác nhận')
        if status == 'EXTENDED':
            risks.append('Giá đã kéo xa; cần đánh giá lại điểm vào')
        if status == 'RISK':
            risks.append('Ưu tiên tín hiệu giảm/thoát của hệ thống')
        if status == 'INVALIDATED':
            risks.append('Mất vùng hỗ trợ tham chiếu hoặc hết thời hạn theo dõi')
        changed = 'NEW' if not old or old.get('status') == 'INVALIDATED' else 'UPGRADED' if status == 'PRIORITY' and old.get('status') != 'PRIORITY' else 'INVALIDATED' if status == 'INVALIDATED' else 'CONTINUED'
        count('candidate_' + status.lower())
        output.append({
            'symbol_id': stock['symbol_id'], 'symbol': stock['symbol'], 'sector': stock.get('sector'),
            'status': status, 'change': changed, 'first_seen': first, 'age_sessions': age,
            'close': close, 'daily_pct': round(change_pct, 2), 'system_action': action, 'monthly_state': monthly,
            'recovery': recovery, 'burst': burst, 'late_burst': late, 'setup': setup,
            'families': [name for name, matched in (('RECOVERY', recovery), ('CONTINUATION', setup or active_momentum), ('UNUSUAL_VOLUME', burst)) if matched],
            'reasons': reasons, 'risks': risks, 'trigger_price': trigger, 'invalidation_price': stop,
            'support_reference': support, 'resistance_reference': max(number(b['high']) for b in prices[-21:-1]),
            'next_step': 'Quan sát khả năng giữ vùng vừa vượt và phản ứng tại kháng cự; kiểm tra lại giá mở cửa phiên kế tiếp',
            'evidence': {'ema20': t.get('ema20'), 'rsi14': t.get('rsi14'), 'macd_histogram': t.get('macd_histogram'),
                         'volume_ratio20': t.get('volume_ratio20'), 'up_burst_value_vnd': round(up_value),
                         'up_burst_share_pct': round(share * 100, 2), 'minute_complete': minute_ok,
                         'events': up, 'momentum_stage': momentum.get('stage'), 'funnel_stage': funnel.get('stage'),
                         'macd_stage': macd.get('stage'), 'average_turnover_vnd': round(turnover), 'close_location': round(clv, 3)},
            'notify': status in ('PRIORITY','OBSERVE') and (changed in ('NEW','UPGRADED') or burst),
        })
    order = {'PRIORITY': 0, 'OBSERVE': 1, 'EXTENDED': 2, 'RISK': 3, 'INVALIDATED': 4}
    output.sort(key=lambda r: (order[r['status']], not r['late_burst'], -r['evidence']['up_burst_share_pct'],
                               -r['evidence']['up_burst_value_vnd'], r['symbol']))
    return [{**row, 'rank': i + 1} for i, row in enumerate(output)]


def rpc(client, name, payload):
    # Only side-effect-free reads may retry automatically. Never replay claims or sends.
    attempts = 2 if name in ('opportunity_context', 'opportunity_input_batch') else 1
    for attempt in range(attempts):
        try:
            response = client._client.post('/rpc/' + name, json=payload)
        except httpx.RequestError:
            if attempt + 1 < attempts:
                sleep(1)
                continue
            raise RuntimeError(f'{name}: connection failed') from None
        if response.is_success:
            return response.json()
        if response.status_code in (408, 429, 500, 502, 503, 504) and attempt + 1 < attempts:
            sleep(1)
            continue
        try:
            body = response.json()
            detail = {key: str(body[key])[:600] for key in ('code', 'message', 'details', 'hint') if body.get(key)}
        except (ValueError, AttributeError):
            detail = {'message': response.reason_phrase}
        raise RuntimeError(f'{name}: HTTP {response.status_code} ' + json.dumps(detail, ensure_ascii=False))
    raise RuntimeError('RPC read exhausted')


def _read_publication(client, pub_id):
    response = client._get('/opportunity_publications', params={'id': f'eq.{pub_id}', 'select': 'id,trading_date,phase,rows,summary', 'limit': '1'})
    response.raise_for_status()
    saved = response.json()[0]
    return {'status': 'PUBLISHED' if saved['phase'] == 'RADAR' else 'PROVISIONAL', 'date': saved['trading_date'],
            'publication_id': saved['id'], 'phase': saved['phase'], 'rows': saved['rows'], 'summary': saved['summary']}


def _build_phase(client, inputs, day: date, phase: str, historical: bool):
    eod, radar = inputs['eod'], inputs.get('radar') or {}
    previous = inputs.get('previous') or {}
    radar_time = radar.get('published_at') if phase == 'RADAR' else None
    claim = rpc(client, 'begin_opportunity_build', {'p_day': day.isoformat(), 'p_phase': phase, 'p_version': VERSION,
        'p_eod': eod['finished_at'], 'p_radar': radar_time, 'p_previous': previous.get('id')})
    if claim['action'] == 'READY':
        return _read_publication(client, claim['publication_id'])
    if claim['action'] != 'RUN':
        return {'status': claim['action'], 'date': day.isoformat(), 'phase': phase}
    token = claim['token']
    keys = {'trading_date': f'eq.{day.isoformat()}', 'phase': f'eq.{phase}', 'token': f'eq.{token}', 'status': 'eq.PROCESSING'}
    try:
        stocks, failed = [], []
        symbol_ids = inputs['symbol_ids']
        deadline, consecutive_failures = monotonic() + 480, 0
        for offset in range(0, len(symbol_ids), 25):
            if monotonic() > deadline or consecutive_failures >= 2:
                failed.append({'symbols': symbol_ids[offset:], 'error': 'Stopped at bounded input-read budget; remaining symbols will be retried.'})
                break
            batch_ids = symbol_ids[offset:offset + 25]
            try:
                batch = rpc(client, 'opportunity_input_batch', {'p_day': day.isoformat(), 'p_ids': batch_ids,
                    'p_revision': eod['source_revision'], 'p_minutes': phase == 'RADAR'})
                if len(batch) != len(batch_ids) or {int(s['symbol_id']) for s in batch} != set(batch_ids):
                    raise ValueError('Missing or duplicate stock in input batch')
                stocks.extend(batch)
                consecutive_failures = 0
            except (RuntimeError, ValueError, httpx.HTTPError) as error:
                consecutive_failures += 1
                failed.append({'symbols': batch_ids, 'error': str(error)[:800]})
                print(json.dumps({'date': day.isoformat(), 'phase': phase, 'batch_failed': failed[-1]}, ensure_ascii=False), flush=True)
            progress = client._client.patch('/opportunity_builds', params=keys,
                json={'progress': {'processed_symbols': len(stocks), 'expected_symbols': len(symbol_ids), 'failed_batches': len(failed)}})
            progress.raise_for_status()
        if not stocks:
            raise RuntimeError('Không đọc được nhóm mã nào; xem lỗi đầu vào trong log action.')
        audit = {}
        rows = assess(stocks, day.isoformat(), previous.get('rows'), audit, minutes_checked=phase == 'RADAR')
        complete = not failed and len(stocks) == len(symbol_ids)
        summary = {'total': len(rows), 'priority': sum(r['status'] == 'PRIORITY' for r in rows),
            'hypothesis': 'Research shortlist; no measured win probability', 'breadth': inputs.get('breadth'),
            'radar_coverage': f"{radar.get('baseline_ready_symbols', 0)}/{radar.get('expected_symbols', 0)}" if phase == 'RADAR' else 'Chưa đối chiếu',
            'phase_requested': phase, 'input_complete': complete, 'processed_symbols': len(stocks),
            'expected_symbols': len(symbol_ids), 'failed_symbol_ids': [i for b in failed for i in b['symbols']],
            'diagnostics': audit}
        digest = sha256(json.dumps({'version': VERSION, 'phase': phase, 'rows': rows, 'summary': summary,
            'eod': eod['finished_at'], 'radar': radar_time}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        pub_id = rpc(client, 'finish_opportunity_build', {'p_day': day.isoformat(), 'p_phase': phase, 'p_token': token,
            'p_hash': digest, 'p_rows': rows, 'p_summary': summary, 'p_historical': historical or day != vietnam_today()})
        return {'status': 'PUBLISHED' if phase == 'RADAR' and complete else 'PROVISIONAL', 'date': day.isoformat(),
                'publication_id': pub_id, 'phase': phase if complete else 'EOD', 'rows': rows, 'summary': summary,
                'build_failed': not complete}
    except Exception:
        # Detail stays in the action log; the UI receives a concise non-secret error.
        response = client._client.patch('/opportunity_builds', params=keys, json={'status': 'FAILED',
            'finished_at': datetime.now(timezone.utc).isoformat(),
            'last_error': 'Tổng hợp thất bại. Xem log action để xác định nhóm mã hoặc nguồn gặp lỗi.'})
        response.raise_for_status()
        raise


def publish(client, day: date, historical: bool = True, phase: str = 'AUTO'):
    inputs = rpc(client, 'opportunity_context', {'p_day': day.isoformat()})
    eod, radar = inputs.get('eod') or {}, inputs.get('radar') or {}
    if not eod.get('finished_at') or (eod.get('counts') or {}).get('publication_status') not in ('COMPLETE','COMPLETE_WITH_MISSING','PARTIAL'):
        return {'status': 'WAIT_EOD', 'date': day.isoformat()}
    phases = ['EOD']
    if phase == 'AUTO' and radar.get('status') == 'PUBLISHED' and radar.get('published_at'):
        phases.append('RADAR')
    result, errors = None, []
    for current in phases:
        try:
            candidate = _build_phase(client, inputs, day, current, historical)
            if candidate['status'] in ('PROVISIONAL', 'PUBLISHED'):
                result = candidate
            elif candidate['status'] == 'RETRY_LIMIT':
                errors.append({'phase': current, 'error': 'Đã hết 3 lượt tự phục hồi cho nguồn dữ liệu này.'})
                if result is None:
                    result = candidate
            elif result is None:
                result = candidate
        except (RuntimeError, ValueError, httpx.HTTPError) as error:
            errors.append({'phase': current, 'error': str(error)[:1200]})
            print(json.dumps({'date': day.isoformat(), 'failed': errors[-1]}, ensure_ascii=False), flush=True)
    if errors and (not result or result['status'] != 'PUBLISHED'):
        if result:
            return {**result, 'build_failed': True, 'errors': errors}
        raise RuntimeError(json.dumps(errors, ensure_ascii=False))
    return result


def telegram_text(publication: dict, rows: list[dict]) -> str:
    day = publication['date']
    base = os.getenv('PROTSTOCK_APP_URL', 'https://protstock.vercel.app').rstrip('/')
    params = urlencode({'date': day, 'publication': publication['publication_id']})
    lines = [f'🔎 PROT STOCK · CƠ HỘI PHIÊN TỚI\nDữ liệu {day} · cập nhật {datetime.now(VN):%H:%M}']
    for row in rows:
        reason = ' · '.join(row['reasons'][:2])
        risk = '; '.join(row['risks'][:2]) or 'Kiểm tra điểm vào và rủi ro trước khi quyết định'
        lines.append(f"\n{row['symbol']} · {'Ưu tiên theo dõi' if row['status']=='PRIORITY' else 'Theo dõi thêm'}"
                     f"\n{reason}\nHệ thống {row['system_action']} · {risk}"
                     f"\n{base}/#analysis?{params}&symbol={row['symbol']}")
    lines.append('\nDanh sách nghiên cứu cho phiên giao dịch kế tiếp, chưa phải tín hiệu mua.')
    return '\n'.join(lines)


def notify(client, publication: dict):
    if publication.get('phase') == 'EOD' or publication.get('summary', {}).get('input_complete') is False:
        return {'status': 'PROVISIONAL_NOT_SENT'}
    day = publication['date']
    now = datetime.now(VN)
    # Replays/repairs and late jobs must never promote yesterday's evidence as fresh.
    if day != now.date().isoformat() or now.weekday() > 4 or now.hour < 15 or now.hour >= 23:
        return {'status': 'HISTORICAL_OR_OUTSIDE_WINDOW'}
    owners = client._pages('user_profiles', {'select': 'user_id', 'username': 'eq.prot', 'role': 'eq.ADMIN', 'status': 'eq.ACTIVE'})
    if not owners:
        return {'status': 'NO_OWNER'}
    owner = owners[0]['user_id']
    settings = client._pages('opportunity_notification_settings', {'select': '*', 'user_id': f'eq.{owner}'})
    pref = settings[0] if settings else {'enabled': True, 'scope': 'ALL', 'max_symbols': 5}
    token, chat = os.getenv('TELEGRAM_BOT_TOKEN'), os.getenv('TELEGRAM_CHAT_ID')
    if not pref['enabled'] or not token or not chat:
        return {'status': 'DISABLED'}
    rows = [r for r in publication['rows'] if r['notify']]
    if pref['scope'] == 'WATCHLIST':
        watched = client._pages('user_watchlists', {'select': 'items', 'user_id': f'eq.{owner}'})
        names = {r['symbol'] for w in watched for r in w.get('items', []) if r.get('status') != 'Off'}
        rows = [r for r in rows if r['symbol'] in names]
    rows = rows[:int(pref['max_symbols'])]
    if not rows:
        return {'status': 'NO_NEW_CANDIDATES'}
    text = telegram_text(publication, rows)
    # Keep complete symbols/links; do not truncate the finished message.
    while len(text) > 3900 and len(rows) > 1:
        rows = rows[:-1]
        text = telegram_text(publication, rows)
    # A unique date/owner claim prevents parallel jobs and repair workflows from resending.
    claim = client._client.post('/opportunity_notifications', json={'user_id': owner, 'trading_date': day,
        'publication_id': publication['publication_id'], 'status': 'CLAIMED', 'payload': {'text': text, 'symbols': [r['symbol'] for r in rows]}})
    if claim.status_code == 409:
        return {'status': 'ALREADY_CLAIMED'}
    claim.raise_for_status()
    state, message_id = 'UNKNOWN', None
    try:
        response = httpx.post(f'https://api.telegram.org/bot{token}/sendMessage',
            json={'chat_id': chat, 'text': text, 'link_preview_options': {'is_disabled': True}}, timeout=30)
        if response.is_success and response.json().get('ok'):
            state, message_id = 'SENT', response.json()['result']['message_id']
        else:
            state = 'FAILED'
    except httpx.RequestError:
        pass  # Ambiguous delivery: do not automatically send a duplicate.
    update = client._client.patch('/opportunity_notifications', params={'user_id': f'eq.{owner}', 'trading_date': f'eq.{day}'},
        json={'status': state, 'message_id': message_id, 'updated_at': datetime.now(timezone.utc).isoformat()})
    update.raise_for_status()
    if state != 'SENT':
        raise RuntimeError(f'Opportunity Telegram delivery {state}; inspect the delivery log before retrying')
    return {'status': state, 'symbols': len(rows)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start-date', type=date.fromisoformat)
    parser.add_argument('--end-date', type=date.fromisoformat)
    parser.add_argument('--phase', choices=('AUTO', 'EOD'), default='AUTO')
    parser.add_argument('--notify', action='store_true')
    args = parser.parse_args()
    client = SupabaseRestClient(Settings.from_env())
    client._client.timeout = httpx.Timeout(45)
    try:
        end = args.end_date
        if end is None:
            latest = client._pages('job_runs', {'select': 'trading_date', 'status': 'eq.SUCCEEDED',
                'counts->>published_signals': 'not.is.null', 'trading_date': f'lte.{vietnam_today().isoformat()}',
                'order': 'trading_date.desc,finished_at.desc', 'limit': '1'})
            if not latest:
                print(json.dumps({'status': 'WAIT_EOD'}), flush=True)
                return
            end = date.fromisoformat(latest[0]['trading_date'])
        start = args.start_date or end
        if start > end or (end - start).days > 90:
            parser.error('Use an ascending range of at most 90 calendar days')
        days = [start + timedelta(days=i) for i in range((end-start).days + 1) if (start+timedelta(days=i)).weekday()<5]
        # Serve the newest sessions first, then repair chronology, then refresh the newest campaigns.
        recent = days[-2:]
        ordered = recent + days[:-2] + recent if args.start_date and len(days)>2 else days
        failed = {}
        for day in ordered:
            try:
                result = publish(client, day, historical=bool(args.start_date) or not args.notify, phase=args.phase)
                delivery = notify(client, result) if args.notify and not args.start_date and result['status'] == 'PUBLISHED' else None
                print(json.dumps({k: v for k, v in result.items() if k != 'rows'} | {'notification': delivery}, ensure_ascii=False), flush=True)
                if result.get('build_failed') or result['status'] == 'RETRY_LIMIT':
                    failed[day.isoformat()] = result['status']
                else:
                    failed.pop(day.isoformat(), None)
            except (RuntimeError, ValueError, httpx.HTTPError) as error:
                failed[day.isoformat()] = str(error)[:1200]
                print(json.dumps({'date': day.isoformat(), 'status': 'FAILED', 'error': failed[day.isoformat()]}, ensure_ascii=False), flush=True)
        if failed:
            raise RuntimeError('Some opportunity sessions failed after processing the remaining dates: ' + json.dumps(failed, ensure_ascii=False))
    finally:
        client.close()


if __name__ == '__main__':
    main()
