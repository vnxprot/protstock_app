"""Refresh the agreed 277-symbol monthly policy using stored prices only.

Current mode rebuilds today's dependent decisions. History mode refreshes only
research assessments since app inception, preserving published old decisions.
No provider requests, trade simulation, notifications or portfolio mutations.
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date, timedelta
from pathlib import Path

from .analysis import ALGORITHM_VERSION
from .challenger_research import assess_challenger, assess_challenger_strategies, recovery_status
from .config import Settings
from .eod import (_coherent_benchmark_rows, _confirmed_month_end, _confirmed_week_end,
                  _history_limit, _stock_rows_as_of, rebuild_signals)
from .funnel_replay import _period_closes
from .indicators import calculate_indicators
from .momentum_radar import assess_momentum_radar
from .price_basis import price_row_usable, same_source_window, with_volume_segments
from .signal_funnel import assess_funnel
from .supabase_rest import SupabaseRestClient
from .timeframes import aggregate_bars
from .trend_context import monthly_timeline

APP_START = date(2026, 9, 11)


def fixed_universe(client: SupabaseRestClient) -> list[dict]:
    path = Path(__file__).resolve().parents[2] / "data" / "universe.csv"
    with path.open(encoding="utf-8-sig", newline="") as source:
        expected = {row["symbol"] for row in csv.DictReader(source) if row.get("active", "true").lower() == "true"}
    symbols = client.active_symbols()
    actual = {row["symbol"] for row in symbols}
    if len(expected) != 277 or actual != expected:
        raise ValueError(f"Frozen universe mismatch: manifest={len(expected)}, active={len(actual)}, missing={sorted(expected-actual)}, extra={sorted(actual-expected)}")
    return sorted(symbols, key=lambda row: row["symbol"])


def refresh_history(client: SupabaseRestClient, start: date, end: date, shard: int = 0, shards: int = 1) -> dict:
    if start < APP_START or start > end or shards < 1 or not 0 <= shard < shards:
        raise ValueError("Refresh is restricted to app history from 2026-09-11 and a valid shard")
    symbols = fixed_universe(client)[shard::shards]
    index = client.market_index("VNINDEX")
    benchmark = _coherent_benchmark_rows(client.index_price_history(index["id"], _history_limit(end)), end)
    if not benchmark or benchmark[-1]["date"] != end.isoformat():
        raise ValueError(f"No completed stored VNINDEX session on {end}")
    sessions = [date.fromisoformat(row["date"]) for row in benchmark]
    closed_weeks, closed_months = _period_closes(sessions)
    final_week = _confirmed_week_end(client, end, benchmark)
    final_month = _confirmed_month_end(client, end, benchmark)
    if final_week:
        closed_weeks.add(final_week)
    if final_month:
        closed_months.add(final_month)
    day_rows = {row["date"]: i for i, row in enumerate(benchmark)}
    breadth = {row["trading_date"]: row for row in client._pages("market_breadth_snapshots", {
        "select": "*", "and": f"(trading_date.gte.{start},trading_date.lte.{end})"})}
    champions = {(row["symbol_id"], row["as_of_date"]): row for row in client._pages("consolidated_signals", {
        "select": "symbol_id,as_of_date,composite_action", "timeframe": "eq.D",
        "and": f"(as_of_date.gte.{start},as_of_date.lte.{end})"})}
    market = {}
    for day in sessions:
        if start <= day <= end:
            prefix = benchmark[:day_rows[day.isoformat()] + 1]
            market[day.isoformat()] = {"trading_date": day.isoformat(), "breadth": breadth.get(day.isoformat(), {}),
                                      "vnindex_snapshot": calculate_indicators(prefix).to_dict(), "recovery": recovery_status(prefix)}
    counts = {"start": str(start), "end": str(end), "shard": shard, "manifest": 277,
              "symbols": len(symbols), "sessions": 0, "missing": [], "failed": [], "monthly_states": 0}
    first_period = start.replace(day=1) - timedelta(days=1)
    for symbol in symbols:
        try:
            stored = _stock_rows_as_of(client.price_history(symbol["id"], _history_limit(end)), end)
            rows = [{**row, "date": row["trading_date"]} for row in with_volume_segments(stored, [], as_of_date=end)]
            if not rows or not same_source_window(rows) or any(not price_row_usable(row) for row in rows):
                counts["missing"].append({"symbol": symbol["symbol"], "reason": "PRICE_HISTORY_UNAVAILABLE_OR_UNVERIFIED"})
                continue
            months = [bar for bar in aggregate_bars(rows, "M", confirmed_month_end=final_month) if bar["is_complete"]]
            states = [{"symbol_id": symbol["id"], "period_end": item["period_end"],
                       "policy_version": item["policy_version"], "trend_state": item["state"], "evidence": item}
                      for item in monthly_timeline(months) if item["period_end"] >= first_period.isoformat()]
            if states:
                client.upsert("monthly_trend_states", states, "symbol_id,period_end,policy_version")
                counts["monthly_states"] += len(states)
            positions = {row["date"]: i for i, row in enumerate(rows)}
            funnels, radars, strategies, summaries = [], [], [], []
            for day, context in market.items():
                if day not in positions:
                    counts["missing"].append({"symbol": symbol["symbol"], "date": day, "reason": "NO_STORED_SESSION"})
                    continue
                prefix = rows[:positions[day] + 1]
                parsed = date.fromisoformat(day)
                ends = {"confirmed_week_end": parsed if parsed in closed_weeks else None,
                        "confirmed_month_end": parsed if parsed in closed_months else None}
                funnel = assess_funnel(symbol["id"], prefix, **ends)
                month = funnel.get("evidence", {}).get("monthly")
                champion = champions.get((symbol["id"], day), {}).get("composite_action", "WATCH")
                branches = assess_challenger_strategies(symbol["id"], prefix, context,
                    exchange=symbol.get("exchange"), champion_action=champion, monthly_evidence=month, **ends)
                strategies.extend(branches)
                summaries.append(assess_challenger(symbol["id"], prefix, context, champion_action=champion,
                    exchange=symbol.get("exchange"), monthly_evidence=month, strategy_assessments=branches, **ends))
                funnels.append(funnel)
                radars.append(assess_momentum_radar(symbol["id"], prefix, **ends))
                counts["sessions"] += 1
            for table, pending, conflict in (
                ("signal_funnel_assessments", funnels, "symbol_id,as_of_date,version"),
                ("momentum_radar_assessments", radars, "symbol_id,as_of_date,version"),
                ("challenger_strategy_assessments", strategies, "symbol_id,trading_date,engine_version,strategy_code"),
                ("challenger_signal_assessments", summaries, "symbol_id,trading_date,engine_version")):
                for offset in range(0, len(pending), 100):
                    client.upsert(table, pending[offset:offset + 100], conflict)
            print(json.dumps({"symbol": symbol["symbol"], "sessions": len(funnels), "shard": shard}), flush=True)
        except Exception as exc:
            counts["failed"].append({"symbol": symbol["symbol"], "error": str(exc)[:300]})
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("current", "history"), required=True)
    parser.add_argument("--start", type=date.fromisoformat, default=APP_START)
    parser.add_argument("--end", type=date.fromisoformat, required=True)
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--shards", type=int, default=1)
    args = parser.parse_args()
    client = SupabaseRestClient(Settings.from_env())
    try:
        fixed_universe(client)
        if args.mode == "current":
            result = rebuild_signals(args.end)
            result["algorithm_version"] = ALGORITHM_VERSION
        else:
            result = refresh_history(client, args.start, args.end, args.shard, args.shards)
        Path(f"trend-refresh-{args.mode}-{args.shard}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, default=str), flush=True)
        if result.get("failed"):
            raise SystemExit(1)
    finally:
        client.close()


if __name__ == "__main__":
    main()
