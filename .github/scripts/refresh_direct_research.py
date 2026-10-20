"""Refresh the active locked universe's archive; never executes a backtest."""
from datetime import date
import json
import os

from protstock.config import Settings
from protstock.research_prices import sync_research_prices
from protstock.supabase_rest import SupabaseRestClient


client = SupabaseRestClient(Settings.from_env())
try:
    names = {item["symbol"] for item in client.active_symbols()}
finally:
    client.close()
result = sync_research_prices(date(2021, 1, 1), date.fromisoformat(os.environ["TRADING_DATE"]),
                              symbols=names, pause_seconds=1, apply=True)
print(json.dumps(result, ensure_ascii=False), flush=True)
if result["failed"] or result["missing"] or result["incomplete"]:
    raise SystemExit("Research refresh incomplete; see per-symbol coverage and errors")
