"""Populate one completed EOD shadow session without writing Champion tables."""

from __future__ import annotations

import argparse
from datetime import date

from .config import Settings
from .eod import _write_challenger_shadow
from .period_signals import monthly_trend
from .provider_vnstock import STOCK_PRICE_UNIT
from .supabase_rest import SupabaseRestClient
from .timeframes import aggregate_bars


def run_shadow_session(client: SupabaseRestClient, trading_date: str | None = None) -> dict:
    breadth_rows = client._pages("market_breadth_snapshots", {
        "select": "*", **({"trading_date": f"eq.{trading_date}"} if trading_date else {}),
        "order": "trading_date.desc", "limit": "1"}, limit=1)
    if not breadth_rows:
        raise ValueError("No completed market breadth snapshot is available")
    breadth = breadth_rows[0]
    day = breadth["trading_date"]
    market_context = {"trading_date": day, "breadth": breadth,
                      "vnindex_snapshot": {"trend_state": breadth.get("vnindex_trend_state", "UNKNOWN")}}
    pending = []
    skipped = []
    symbols = client.active_symbols()
    for symbol in symbols:
        history = client.price_history(symbol["id"], 900)
        rows = [{**row, "date": row["trading_date"]} for row in history if row["trading_date"] <= day]
        if (not rows or rows[-1]["date"] != day
                or rows[-1].get("quality_status") != "VALID"
                or rows[-1].get("price_unit") != STOCK_PRICE_UNIT):
            skipped.append(symbol["symbol"])
            continue
        completed_months = [bar for bar in aggregate_bars(rows, "M") if bar["is_complete"]]
        context = {"candidate_exchange": symbol.get("exchange"),
                   "monthly_snapshot": monthly_trend(completed_months)}
        pending.append((symbol["id"], "D", rows, [], {}, context))
    if not pending:
        raise ValueError("No verified same-day stock prices are available for shadow assessment")
    counts, warnings = {}, []
    _write_challenger_shadow(client, pending, market_context, date.fromisoformat(day), counts, warnings)
    if warnings:
        raise RuntimeError(", ".join(warnings))
    return {"trading_date": day, "expected_symbols": len(symbols), "priced_symbols": len(pending),
            "skipped_count": len(skipped), "skipped_examples": skipped[:20], **counts}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run an isolated Challenger shadow session")
    parser.add_argument("--date", help="Completed trading date; default latest stored breadth session")
    args = parser.parse_args()
    client = SupabaseRestClient(Settings.from_env())
    try:
        print(run_shadow_session(client, args.date))
    finally:
        client.close()


if __name__ == "__main__":
    main()
