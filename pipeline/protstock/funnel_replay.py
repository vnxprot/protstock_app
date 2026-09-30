"""Historical shadow replay; no signal publication or portfolio mutation."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from .config import Settings
from .outcomes import evaluate_signal_outcome
from .signal_funnel import assess_funnel
from .supabase_rest import SupabaseRestClient


def _period_closes(session_dates: list[date]) -> tuple[set[date], set[date]]:
    weeks: dict[date, date] = {}
    months: dict[tuple[int, int], date] = {}
    for day in session_dates:
        weeks[day - timedelta(days=day.weekday())] = day
        months[(day.year, day.month)] = day
    last = session_dates[-1]
    closed_weeks = {day for day in weeks.values() if day < last or day.weekday() == 4}
    closed_months = {day for day in months.values() if day < last or day.day == monthrange(day.year, day.month)[1]}
    return closed_weeks, closed_months


def replay_symbol(symbol_id: int, rows: list[dict], session_dates: list[date],
                  start_date: date, end_date: date) -> tuple[list[dict], list[dict]]:
    daily = sorted(({**row, "date": row["trading_date"]} for row in rows
                    if row["trading_date"] <= end_date.isoformat()), key=lambda row: row["date"])
    closed_weeks, closed_months = _period_closes(session_dates)
    assessments: list[dict] = []
    outcomes: list[dict] = []
    for index, bar in enumerate(daily):
        day = date.fromisoformat(bar["date"])
        if not start_date <= day <= end_date:
            continue
        assessment = assess_funnel(
            symbol_id, daily[:index + 1],
            confirmed_week_end=day if day in closed_weeks else None,
            confirmed_month_end=day if day in closed_months else None,
        )
        assessments.append(assessment)
        if assessment["stage"] != "DAILY_TRIGGER":
            continue
        for horizon in (5, 10, 20):
            result = evaluate_signal_outcome(
                {"id": "shadow", "as_of_date": bar["date"],
                 "evidence": {"invalidation_price": assessment["evidence"]["weekly"]["invalidation"]}},
                daily, horizon,
            )
            if result is None:
                continue
            outcomes.append({"symbol_id": symbol_id, "as_of_date": bar["date"],
                             "version": assessment["version"], "setup_id": assessment["setup_id"],
                             **{key: result[key] for key in ("horizon_days", "forward_return_pct",
                                                               "max_drawdown_pct", "hit_invalidation",
                                                               "calculation_version", "price_fingerprint")}})
    return assessments, outcomes


def run_funnel_replay(start_date: date, end_date: date, *, symbol_offset: int = 0,
                      symbol_limit: int | None = None, apply: bool = False) -> dict:
    if start_date > end_date:
        raise ValueError("start_date must be on or before end_date")
    client = SupabaseRestClient(Settings.from_env())
    totals = {"symbols": 0, "assessments": 0, "daily_triggers": 0,
              "quarantined": 0, "outcomes": 0, "mode": "apply" if apply else "dry-run"}
    try:
        symbols = client.all_symbols_for_replay()[symbol_offset:]
        if symbol_limit is not None:
            symbols = symbols[:symbol_limit]
        index = client.market_index("VNINDEX")
        index_rows = client.index_price_history(index["id"], 2600)
        sessions = [date.fromisoformat(row["trading_date"]) for row in index_rows
                    if row["trading_date"] <= end_date.isoformat()]
        if not sessions:
            raise ValueError("VNINDEX session calendar is unavailable")
        for symbol in symbols:
            rows = client.price_history(symbol["id"], 2600)
            assessments, outcomes = replay_symbol(symbol["id"], rows, sessions, start_date, end_date)
            totals["symbols"] += 1
            totals["assessments"] += len(assessments)
            totals["daily_triggers"] += sum(row["stage"] == "DAILY_TRIGGER" for row in assessments)
            totals["quarantined"] += sum(row["stage"] == "DATA_QUARANTINED" for row in assessments)
            totals["outcomes"] += len(outcomes)
            if apply:
                for offset in range(0, len(assessments), 100):
                    client.upsert("signal_funnel_assessments", assessments[offset:offset + 100],
                                  "symbol_id,as_of_date,version")
                for offset in range(0, len(outcomes), 100):
                    client.upsert("signal_funnel_outcomes", outcomes[offset:offset + 100],
                                  "symbol_id,as_of_date,version,horizon_days")
        return totals
    finally:
        client.close()
