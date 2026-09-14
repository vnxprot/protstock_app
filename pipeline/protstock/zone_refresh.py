"""Explicit zone-only refresh from stored OHLCV; no provider fetch or alerts."""
from __future__ import annotations

import argparse
import json
from datetime import date

from .config import Settings
from .fibonacci import build_fibonacci_context
from .supabase_rest import SupabaseRestClient
from .timeframes import aggregate_bars
from .zones import detect_zones


def zone_payloads(symbol_id: int, timeframe: str, rows: list[dict], context: dict) -> list[dict]:
    return [{"symbol_id": symbol_id, "timeframe": timeframe, "zone_type": zone["zone_type"],
             "start_date": rows[zone["start_index"]]["date"], "as_of_date": rows[-1]["date"],
             "lower_price": zone["lower_price"], "upper_price": zone["upper_price"],
             "touches": zone["touches"], "strength": zone["strength"], "evidence": zone["evidence"],
             "algorithm_version": "pivot-volume-reaction-v1", "active": True}
            for zone in detect_zones(rows, fibonacci_context=context)]


def refresh_zones(cutoff: date, *, client=None) -> dict:
    owns_client = client is None
    client = client or SupabaseRestClient(Settings.from_env())
    counts = {"symbols": 0, "zones": 0, "failed": 0}
    try:
        for symbol in client.active_symbols():
            try:
                rows = [{**row, "date": str(row["trading_date"])} for row in client.price_history(symbol["id"], 5000) if str(row["trading_date"]) <= cutoff.isoformat()]
                if not rows:
                    continue
                context = build_fibonacci_context(rows)
                for timeframe, scoped in {"D": rows, "W": aggregate_bars(rows, "W"), "M": aggregate_bars(rows, "M")}.items():
                    counts["zones"] += client.replace_zone_snapshot(symbol["id"], timeframe, scoped[-1]["date"], zone_payloads(symbol["id"], timeframe, scoped, context))
                counts["symbols"] += 1
            except Exception as exc:
                counts["failed"] += 1
                print(f"Zone refresh failed for {symbol['symbol']}: {type(exc).__name__}", flush=True)
        return counts
    finally:
        if owns_client:
            client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=date.fromisoformat, default=date.today())
    result = refresh_zones(parser.parse_args().date)
    print(json.dumps(result))
    raise SystemExit(1 if result["failed"] else 0)
