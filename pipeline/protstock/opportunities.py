"""Research shortlist only: closed EOD + published minute evidence, never orders."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from urllib.parse import urlencode

import httpx

from .config import Settings, vietnam_today
from .supabase_rest import SupabaseRestClient

VERSION = 'NEXT_SESSION_V1'
VN = timezone(timedelta(hours=7))


def number(value, default=0.0):
    return float(value) if value is not None else default


def assess(stocks: list[dict], day: str, previous: list[dict] | None = None) -> list[dict]:
    """Frozen initial hypotheses; scores express priority, never win probability."""
    prior = {int(r['symbol_id']): r for r in previous or []}
    output = []
    for stock in stocks:
        history = stock.get('technical') or []
        prices = stock.get('prices') or []
        if len(history) < 2 or len(prices) < 21:
            continue
        t, p = history[-1], history[-2]
        bar = prices[-1]
        if t['as_of_date'] != day or bar['trading_date'] != day or bar['quality_status'] != 'VALID':
            continue
        close = number(t.get('close'))
        if close <= 0 or number(bar.get('volume')) <= 0:
            continue
        turnover = close * number(t.get('volume_avg20')) * 1000
        if turnover < 3_000_000_000:
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
        setup = bool(setups) or funnel.get('stage') in ('WEEKLY_READY', 'DAILY_TRIGGER') or macd.get('stage') in ('WATCH_PRICE_CONFIRMATION', 'CONFIRMED')
        active_momentum = momentum.get('stage') in ('SURGE_WATCH','DAILY_BREAKOUT','WEEKLY_CONFIRMED','REACCELERATING')
        first = old.get('first_seen', day) if old and old.get('status') != 'INVALIDATED' else day
        age = sum(b['trading_date'] > first for b in prices)
        if old and age > 5 and (recovery or burst or setup or active_momentum):
            first, age, old = day, 0, None
        carried = bool(old) and old.get('status') not in ('INVALIDATED', 'RISK') and age <= 6
        if not (recovery or burst or setup or active_momentum or carried):
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
            risks.append('Chưa đủ nến phút hoặc lịch sử so sánh cho mã này')
        if not stop:
            risks.append('Điểm vào và stop chưa được hệ thống xác nhận')
        if status == 'EXTENDED':
            risks.append('Giá đã kéo xa; cần đánh giá lại điểm vào')
        if status == 'RISK':
            risks.append('Ưu tiên tín hiệu giảm/thoát của hệ thống')
        if status == 'INVALIDATED':
            risks.append('Mất vùng hỗ trợ tham chiếu hoặc hết thời hạn theo dõi')
        changed = 'NEW' if not old or old.get('status') == 'INVALIDATED' else 'UPGRADED' if status == 'PRIORITY' and old.get('status') != 'PRIORITY' else 'INVALIDATED' if status == 'INVALIDATED' else 'CONTINUED'
        output.append({
            'symbol_id': stock['symbol_id'], 'symbol': stock['symbol'], 'sector': stock.get('sector'),
            'status': status, 'change': changed, 'first_seen': first, 'age_sessions': age,
            'close': close, 'daily_pct': round(change_pct, 2), 'system_action': action, 'monthly_state': monthly,
            'recovery': recovery, 'burst': burst, 'late_burst': late, 'setup': setup,
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
    response = client._client.post('/rpc/' + name, json=payload)
    response.raise_for_status()
    return response.json()


def publish(client, day: date, historical: bool = True):
    inputs = rpc(client, 'opportunity_inputs', {'p_day': day.isoformat()})
    eod, radar = inputs.get('eod') or {}, inputs.get('radar') or {}
    if not eod.get('finished_at') or (eod.get('counts') or {}).get('publication_status') not in ('COMPLETE','COMPLETE_WITH_MISSING','PARTIAL'):
        return {'status': 'WAIT_EOD', 'date': day.isoformat()}
    if radar.get('status') != 'PUBLISHED' or not radar.get('published_at'):
        return {'status': 'WAIT_RADAR', 'date': day.isoformat()}
    rows = assess(inputs['stocks'], day.isoformat(), inputs.get('previous'))
    summary = {'total': len(rows), 'priority': sum(r['status'] == 'PRIORITY' for r in rows),
               'hypothesis': 'Research shortlist; no measured win probability',
               'breadth': {k: (inputs.get('breadth') or {}).get(k) for k in ('vnindex_trend_state','pct_above_sma50')},
               'radar_coverage': f"{radar.get('baseline_ready_symbols')}/{radar.get('expected_symbols')}"}
    digest = sha256(json.dumps({'version': VERSION, 'rows': rows, 'summary': summary,
        'eod': eod['finished_at'], 'radar': radar['published_at']}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    pub_id = rpc(client, 'publish_opportunities', {'p_day': day.isoformat(), 'p_version': VERSION, 'p_hash': digest,
        'p_eod': eod['finished_at'], 'p_radar': radar['published_at'], 'p_rows': rows, 'p_summary': summary,
        'p_historical': historical or day != vietnam_today()})
    return {'status': 'PUBLISHED', 'date': day.isoformat(), 'publication_id': pub_id, 'rows': rows, 'summary': summary}


def telegram_text(publication: dict, rows: list[dict]) -> str:
    day = publication['date']
    base = os.getenv('PROTSTOCK_APP_URL', 'https://protstockapp.vercel.app').rstrip('/')
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
    parser.add_argument('--end-date', type=date.fromisoformat, default=vietnam_today())
    parser.add_argument('--notify', action='store_true')
    args = parser.parse_args()
    start = args.start_date or args.end_date
    if start > args.end_date or (args.end_date - start).days > 90:
        parser.error('Use an ascending range of at most 90 calendar days')
    client = SupabaseRestClient(Settings.from_env())
    client._client.timeout = httpx.Timeout(180)
    try:
        for offset in range((args.end_date - start).days + 1):
            day = start + timedelta(days=offset)
            if day.weekday() > 4:
                continue
            result = publish(client, day, historical=bool(args.start_date) or not args.notify)
            delivery = notify(client, result) if args.notify and not args.start_date and result['status'] == 'PUBLISHED' else None
            print(json.dumps({k: v for k, v in result.items() if k != 'rows'} | {'notification': delivery}, ensure_ascii=False))
            if result['status'] != 'PUBLISHED' and not args.start_date:
                raise RuntimeError(f"Opportunity publication deferred: {result['status']}")
    finally:
        client.close()


if __name__ == '__main__':
    main()
