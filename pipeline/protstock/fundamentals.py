from __future__ import annotations

from datetime import datetime, timezone
from calendar import monthrange
from hashlib import sha256
from uuid import NAMESPACE_URL, uuid5

from .config import Settings
from .supabase_rest import SupabaseRestClient


def _period(value: str) -> tuple[int, int | None]:
    year, *quarter = str(value).replace('_', '-').split('-Q')
    return int(year), int(quarter[0]) if quarter else None


def run_fundamentals(limit: int = 5) -> dict:
    from vnstock import Fundamental
    client, now = SupabaseRestClient(Settings.from_env()), datetime.now(timezone.utc)
    written = failed = 0
    try:
        for symbol in client.active_symbols()[:limit]:
            try:
                equity = Fundamental().equity(symbol['symbol'])
                income = {str(row['period']): row for row in equity.income_statement(period='quarter', orient='time_series').to_dict(orient='records')}
                ratios = {str(row['period']): row for row in equity.ratio(period='quarter', orient='time_series').to_dict(orient='records')}
                for period, row in income.items():
                    year, quarter = _period(period)
                    raw = {**row, **ratios.get(period, {})}
                    digest = sha256(repr(sorted(raw.items())).encode()).hexdigest()
                    period_id = str(uuid5(NAMESPACE_URL, f"protstock:{symbol['id']}:{period}:{digest}"))
                    published = now.isoformat()
                    month = quarter * 3
                    period_end = f"{year}-{month:02d}-{monthrange(year, month)[1]:02d}"
                    client.upsert('fundamental_periods', [{"id": period_id, "symbol_id": symbol['id'], "period_type": "QUARTER", "fiscal_year": year, "fiscal_quarter": quarter, "period_end": period_end, "published_at": published, "available_from": now.date().isoformat(), "source": "VNSTOCK_VCI_PROVISIONAL", "content_hash": digest}], 'symbol_id,period_type,fiscal_year,fiscal_quarter,content_hash')
                    client.upsert('fundamental_metrics', [{"period_id": period_id, "revenue": raw.get('net_revenue') or raw.get('revenue'), "eps": raw.get('earnings_per_share_vnd') or raw.get('diluted_earnings_per_share'), "roe": raw.get('roe'), "debt_to_equity": raw.get('debt_to_equity'), "operating_cash_flow": raw.get('cash_flow_from_operating_activities'), "raw_metrics": raw}], 'period_id')
                    written += 1
            except Exception:
                failed += 1
        return {"periods": written, "failed": failed, "source": "VNSTOCK_VCI_PROVISIONAL"}
    finally:
        client.close()
