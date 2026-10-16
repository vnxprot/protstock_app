"""Enrich existing Challenger funnel dates from stored prices, without rebuilding decisions."""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .config import Settings
from .eod import _coherent_benchmark_rows, _confirmed_month_end, _confirmed_week_end, _history_limit, _stock_rows_as_of
from .funnel_events import funnel_event_metadata
from .funnel_replay import _period_closes
from .price_basis import price_row_usable, same_source_window, with_volume_segments
from .signal_funnel import assess_funnel
from .supabase_rest import SupabaseRestClient
from .trend_refresh import APP_START, fixed_universe

VERSION = "v0.0.0-challenger-trend1"


def enriched_evidence(existing: dict, funnel: dict, sessions: list[str]) -> dict | None:
    """Never attach an event from a different setup or a different decision stage."""
    evidence = existing.get("evidence") or {}
    if (evidence.get("setup_id") != funnel.get("setup_id")
            or evidence.get("funnel_stage") != funnel.get("stage")
            or evidence.get("monthly_state") != funnel.get("monthly_state")):
        return None
    return {**evidence, **funnel_event_metadata(funnel, sessions)}


def refresh_dates(client: SupabaseRestClient, start: date, end: date | None, shard: int, shards: int) -> dict:
    if start < APP_START or shards < 1 or not 0 <= shard < shards:
        raise ValueError("Use app history from 2026-09-11 and a valid shard")
    symbols = fixed_universe(client)[shard::shards]
    latest = client._pages("challenger_strategy_assessments", {
        "select": "trading_date", "strategy_code": "eq.ADAPTIVE_FUNNEL", "engine_version": f"eq.{VERSION}",
        "order": "trading_date.desc", "limit": "1"}, limit=1)
    if not latest:
        raise ValueError("No stored Challenger funnel assessments")
    end = end or date.fromisoformat(latest[0]["trading_date"])
    if start > end or end > date.fromisoformat(latest[0]["trading_date"]):
        raise ValueError("Cutoff must be within existing assessment history")
    index = client.market_index("VNINDEX")
    benchmark = _coherent_benchmark_rows(client.index_price_history(index["id"], _history_limit(end)), end)
    if not benchmark or benchmark[-1]["date"] != str(end):
        raise ValueError("No verified stored VNINDEX calendar at cutoff")
    sessions = [row["date"] for row in benchmark]
    weeks, months = _period_closes([date.fromisoformat(day) for day in sessions])
    for target, closed in ((weeks, _confirmed_week_end(client, end, benchmark)),
                           (months, _confirmed_month_end(client, end, benchmark))):
        if closed:
            target.add(closed)
    report = {"start": str(start), "end": str(end), "shard": shard, "universe": 277,
              "updated": 0, "already_current": 0, "missing": [], "mismatched": [], "failed": []}
    for symbol in symbols:
        try:
            existing = client._pages("challenger_strategy_assessments", {
                "select": "symbol_id,trading_date,engine_version,strategy_code,evidence",
                "symbol_id": f"eq.{symbol['id']}", "strategy_code": "eq.ADAPTIVE_FUNNEL",
                "engine_version": f"eq.{VERSION}", "order": "trading_date.asc",
                "and": f"(trading_date.gte.{start},trading_date.lte.{end})"})
            pending = [row for row in existing if (row.get("evidence") or {}).get("funnel_event_version") != 1]
            report["already_current"] += len(existing) - len(pending)
            if not pending:
                continue
            stored = _stock_rows_as_of(client.price_history(symbol["id"], _history_limit(end)), end)
            rows = [{**row, "date": row["trading_date"]} for row in with_volume_segments(stored, [], as_of_date=end)]
            if not rows or not same_source_window(rows) or any(not price_row_usable(row) for row in rows):
                report["missing"].append({"symbol": symbol["symbol"], "reason": "UNVERIFIED_PRICE_HISTORY"})
                continue
            positions = {row["date"]: i for i, row in enumerate(rows)}
            for record in pending:
                day = record["trading_date"]
                if day not in positions:
                    report["missing"].append({"symbol": symbol["symbol"], "date": day})
                    continue
                parsed = date.fromisoformat(day)
                funnel = assess_funnel(symbol["id"], rows[:positions[day] + 1], adaptive=True,
                    confirmed_week_end=parsed if parsed in weeks else None,
                    confirmed_month_end=parsed if parsed in months else None,
                    monthly_evidence=(record.get("evidence") or {}).get("monthly"))
                evidence = enriched_evidence(record, funnel, sessions)
                if evidence is None:
                    report["mismatched"].append({"symbol": symbol["symbol"], "date": day})
                    continue
                response = client._request("PATCH", "/challenger_strategy_assessments", params={
                    "symbol_id": f"eq.{symbol['id']}", "trading_date": f"eq.{day}",
                    "engine_version": f"eq.{VERSION}", "strategy_code": "eq.ADAPTIVE_FUNNEL"},
                    json={"evidence": evidence}, headers={"Prefer": "return=representation"})
                response.raise_for_status()
                if len(response.json()) != 1:
                    raise RuntimeError(f"Expected exactly one assessment to update on {day}")
                report["updated"] += 1
        except Exception as exc:
            report["failed"].append({"symbol": symbol["symbol"], "error": str(exc)[:300]})
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat, default=APP_START)
    parser.add_argument("--end", type=date.fromisoformat)
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--shards", type=int, default=1)
    args = parser.parse_args()
    client = SupabaseRestClient(Settings.from_env())
    try:
        report = refresh_dates(client, args.start, args.end, args.shard, args.shards)
        Path(f"funnel-dates-{args.shard}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False), flush=True)
        if report["failed"] or report["mismatched"]:
            raise SystemExit(1)
    finally:
        client.close()


if __name__ == "__main__":
    main()
