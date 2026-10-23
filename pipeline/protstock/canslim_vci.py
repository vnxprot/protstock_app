"""VCI-only CANSLIM collection. No samples, cross-source comparisons or backtests."""
import argparse
import json
import math
import unicodedata
from datetime import datetime, timedelta, timezone
from .config import Settings, vietnam_today

BASE = 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/company'

def norm(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value).lower().replace('đ','d')) if not unicodedata.combining(c))

def numeric(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None

def metric_name(item):
    title = norm(item.get('titleEn') or item.get('titleVi') or '')
    if 'diluted earnings per share' in title or 'lai suy giam tren co phieu' in title: return 'eps_diluted'
    if 'basic earnings per share' in title or 'lai co ban tren co phieu' in title or 'basic eps' in title or title in ('eps', 'eps (vnd)', 'earnings per share', 'earnings per share (vnd)'): return 'eps'
    if any(x in title for x in ['net revenue', 'net sales', 'doanh thu thuan', 'total operating income']): return 'revenue'
    if any(x in title for x in ['profit attributable to', 'profit after tax attributable', 'loi nhuan sau thue cua co dong', 'loi nhuan sau thue cua cong ty me']): return 'profit'
    if title in ['profit after tax', 'net profit', 'net profit after tax', 'loi nhuan sau thue thu nhap doanh nghiep', 'loi nhuan sau thue']: return 'profit_total'
    if any(x in title for x in ['equity attributable to owners', 'equity attributable to parent', 'von chu so huu cua cong ty me']): return 'equity_parent'
    if title in ['equity', 'owners equity', "owners' equity", "owner’s equity", "owners’ equity", "owner's equity", 'total equity', 'von chu so huu']: return 'equity'
    return None

def normalize_reports(metadata, reports):
    output = {}
    for section, payload in reports.items():
        fields = {}
        for item in metadata.get(section, []):
            metric = metric_name(item)
            if metric:
                fields[item['field']] = (metric, item.get('titleVi') or item.get('titleEn'))
        for kind, rows in payload.items():
            if kind not in ('years', 'quarters') or not isinstance(rows, list): continue
            for raw in rows:
                year = int(raw.get('yearReport') or raw.get('year') or 0)
                quarter = int(raw.get('lengthReport') or raw.get('quarter') or 0) if kind == 'quarters' else 0
                if not year or (kind == 'quarters' and quarter not in (1,2,3,4)): continue
                period = str(year) + (f'-Q{quarter}' if quarter else '')
                row = output.setdefault(period, {'period': period, 'kind': 'quarter' if quarter else 'year', 'year':year,'quarter':quarter, 'labels':{}})
                for field, (metric, label) in fields.items():
                    value = numeric(raw.get(field))
                    if value is not None:
                        row[metric] = value
                        row['labels'][metric] = label
    # ROE uses matching parent earnings/equity; never mix parent profit and total equity.
    for row in output.values():
        key = str(row['year']-1) + (f"-Q{row['quarter']}" if row['quarter'] else '')
        prior = output.get(key, {})
        for profit, equity in [('profit','equity_parent'), ('profit_total','equity')]:
            earnings = row.get(profit)
            if row['quarter']:
                position = row['year']*4 + row['quarter']-1
                window = [next((r.get(profit) for r in output.values() if r['quarter'] and r['year']*4+r['quarter']-1==position-i), None) for i in range(4)]
                earnings = sum(window) if all(numeric(x) is not None for x in window) else None
            if all(numeric(x) is not None for x in [earnings, row.get(equity), prior.get(equity)]) and row[equity]>0 and prior[equity]>0:
                row['roe'] = earnings / ((row[equity]+prior[equity])/2) * 100
                row['labels']['roe'] = 'ROE 4 quý / vốn bình quân' if row['quarter'] else 'ROE năm / vốn bình quân'
                break
    return sorted(output.values(), key=lambda r:(r['year'],r['quarter']), reverse=True)

def collect(symbol):
    from .market_http import request_json
    from .market_sources import vci_candles
    root = f'{BASE}/{symbol}'
    meta = request_json('GET', root+'/financial-statement/metrics').get('data')
    if not isinstance(meta,dict): raise ValueError('VCI financial metadata unavailable')
    reports = {}
    for section in ['INCOME_STATEMENT','BALANCE_SHEET']:
        payload = request_json('GET', root+'/financial-statement',params={'section':section}).get('data')
        if not isinstance(payload,dict): raise ValueError('VCI financial report unavailable')
        # Metadata may use either report codes or camel-case names.
        key = section if section in meta else next((k for k in meta if norm(k).replace('_','')==section.lower().replace('_','')),section)
        reports[key] = payload
    financial = normalize_reports(meta,reports)
    if not financial: raise ValueError('VCI returned no financial periods')
    today = vietnam_today()
    local = datetime.now(timezone(timedelta(hours=7)))
    last_closed = today if local.hour >= 15 else today-timedelta(days=1)
    bars = vci_candles(symbol, today-timedelta(days=900), today)
    prices = [{'date':r['t'][:10], 'open':r['o'], 'high':r['h'], 'low':r['l'], 'close':r['c'], 'volume':r['v']} for r in bars if r['t'][:10] <= last_closed.isoformat()][-550:]
    return financial, prices

def main():
    from .supabase_rest import SupabaseRestClient
    parser=argparse.ArgumentParser()
    parser.add_argument('--shard',type=int,default=0); parser.add_argument('--shards',type=int,default=1)
    args=parser.parse_args()
    client=SupabaseRestClient(Settings.from_env())
    try:
        for i, stock in enumerate(client.active_symbols()):
            if i%args.shards != args.shard: continue
            stamp=datetime.now(timezone.utc).isoformat()
            try:
                financial,prices=collect(stock['symbol'])
                client.upsert('canslim_vci_data',[{'symbol_id':stock['id'],'financial':financial,'prices':prices,'fetched_at':stamp,'attempted_at':stamp,'status':'READY','error':None}], 'symbol_id')
                print(stock['symbol'],'READY',len(financial),len(prices),flush=True)
            except Exception as error:
                # Partial upsert preserves previous successful data, visibly marked stale.
                client.upsert('canslim_vci_data',[{'symbol_id':stock['id'],'attempted_at':stamp,'status':'ERROR','error':str(error)[:300]}], 'symbol_id')
                print(stock['symbol'],'ERROR',str(error)[:200],flush=True)
    finally: client.close()

if __name__=='__main__': main()
