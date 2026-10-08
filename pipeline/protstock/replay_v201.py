"""Backfill v2.0.1 research assessments from stored EOD bars only."""

from __future__ import annotations

import argparse
import json
from datetime import date

from .config import Settings
from .funnel_replay import _period_closes
from .momentum_radar import assess_momentum_radar
from .signal_funnel import assess_funnel
from .supabase_rest import SupabaseRestClient


def run(as_of: date, *, symbols: set[str] | None = None, apply: bool = False) -> dict:
    client = SupabaseRestClient(Settings.from_env())
    counts = {"date": as_of.isoformat(), "mode": "apply" if apply else "dry-run",
              "symbols": 0, "radar": 0, "funnel": 0, "missing": 0, "stages": {}, "selected": {}}
    try:
        index = client.market_index("VNINDEX")
        sessions = [date.fromisoformat(row["trading_date"]) for row in client.index_price_history(index["id"], 2600)
                    if row["trading_date"] <= as_of.isoformat()]
        if not sessions or sessions[-1] != as_of:
            raise ValueError(f"VNINDEX has no completed stored session on {as_of}")
        closed_weeks, closed_months = _period_closes(sessions)
        selected = client.active_symbols()
        if symbols:
            selected = [item for item in selected if item["symbol"] in symbols]
            missing_symbols = symbols - {item["symbol"] for item in selected}
            if missing_symbols:
                raise ValueError(f"Unknown or inactive symbols: {sorted(missing_symbols)}")
        for symbol in selected:
            rows = [{**row, "date": row["trading_date"]} for row in client.price_history(symbol["id"], 2600)
                    if row["trading_date"] <= as_of.isoformat()]
            if not rows or rows[-1]["date"] != as_of.isoformat():
                counts["missing"] += 1
                continue
            radar = assess_momentum_radar(symbol["id"], rows,
                                          confirmed_week_end=as_of if as_of in closed_weeks else None,
                                          confirmed_month_end=as_of if as_of in closed_months else None)
            funnel = assess_funnel(symbol["id"], rows,
                                   confirmed_week_end=as_of if as_of in closed_weeks else None,
                                   confirmed_month_end=as_of if as_of in closed_months else None)
            counts["symbols"] += 1
            counts["radar"] += 1
            counts["funnel"] += 1
            counts["stages"][radar["stage"]] = counts["stages"].get(radar["stage"], 0) + 1
            if symbols:
                counts["selected"][symbol["symbol"]] = {
                    "radar_stage": radar["stage"], "event_start": radar["event_start_date"],
                    "breakout_date": radar["breakout_date"], "entry_status": radar["entry_status"],
                    "funnel_stage": funnel["stage"], "setup_date": funnel["setup_date"],
                    "trigger_date": funnel["trigger_date"],
                }
            if apply:
                client.upsert("momentum_radar_assessments", [radar], "symbol_id,as_of_date,version")
                client.upsert("signal_funnel_assessments", [funnel], "symbol_id,as_of_date,version")
        if counts["symbols"] == 0:
            raise ValueError("No current symbol prices were available for this session")
        return counts
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat, required=True)
    parser.add_argument("--symbols", help="Optional comma-separated symbols")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    symbols = {item.strip().upper() for item in args.symbols.split(",") if item.strip()} if args.symbols else None
    print(json.dumps(run(args.date, symbols=symbols, apply=args.apply), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
