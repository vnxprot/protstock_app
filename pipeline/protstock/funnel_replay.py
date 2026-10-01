"""Historical shadow replay; no signal publication or portfolio mutation."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from .config import Settings
from .outcomes import evaluate_signal_outcome
from .signal_funnel import assess_funnel
from .supabase_rest import SupabaseRestClient

TRADE_ASSUMPTION_VERSION = "NEXT_OPEN_FEE15BP_TAX10BP_SLIP10BP_V1"


def _research_trade(rows: list[dict], signal_index: int, horizon: int) -> dict | None:
    entry_index = signal_index + 1
    exit_index = entry_index + horizon - 1
    if exit_index >= len(rows):
        return None
    window = rows[signal_index:exit_index + 1]
    if any(row.get("quality_status") != "VALID" for row in window):
        return None
    entry = float(rows[entry_index]["open"]) * 1.001
    exit_price = float(rows[exit_index]["close"]) * .999
    if entry <= 0:
        return None
    return {"entry_date": rows[entry_index]["date"], "entry_price": round(entry, 4),
            "exit_date": rows[exit_index]["date"], "exit_price": round(exit_price, 4),
            "net_return": round(exit_price * (1 - .0015 - .001) / (entry * (1 + .0015)) - 1, 6),
            "assumption_version": TRADE_ASSUMPTION_VERSION}


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
                  start_date: date, end_date: date, *,
                  version_suffix: str = "") -> tuple[list[dict], list[dict]]:
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
        assessment["version"] += version_suffix
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
            trade = _research_trade(daily, index, horizon) if version_suffix else {}
            if version_suffix and trade is None:
                continue
            outcomes.append({"symbol_id": symbol_id, "as_of_date": bar["date"],
                             "version": assessment["version"], "setup_id": assessment["setup_id"],
                             **{key: result[key] for key in ("horizon_days", "forward_return_pct",
                                                               "max_drawdown_pct", "hit_invalidation",
                                                               "calculation_version", "price_fingerprint")},
                             **trade})
    return assessments, outcomes


def run_funnel_replay(start_date: date, end_date: date, *, symbol_offset: int = 0,
                      symbol_limit: int | None = None, apply: bool = False,
                      price_basis: str = "stored") -> dict:
    if start_date > end_date:
        raise ValueError("start_date must be on or before end_date")
    if price_basis not in {"stored", "research"}:
        raise ValueError("price_basis must be stored or research")
    client = SupabaseRestClient(Settings.from_env())
    totals = {"symbols": 0, "assessments": 0, "daily_triggers": 0,
              "quarantined": 0, "outcomes": 0, "missing_price_series": 0,
              "price_basis": price_basis, "mode": "apply" if apply else "dry-run"}
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
            if price_basis == "research":
                status = client.research_price_status(symbol["id"])
                if (not status or status["coverage_status"] != "MATCHED"
                        or status["requested_start_date"] > start_date.isoformat()
                        or status["requested_end_date"] < end_date.isoformat()):
                    totals["missing_price_series"] += 1
                    continue
            rows = (client.research_price_history(symbol["id"], 2600) if price_basis == "research"
                    else client.price_history(symbol["id"], 2600))
            if price_basis == "research" and (not rows or any(row.get("quality_status") != "VALID"
                                                              for row in rows if row["trading_date"] <= end_date.isoformat())):
                totals["missing_price_series"] += 1
                continue
            assessments, outcomes = replay_symbol(symbol["id"], rows, sessions, start_date, end_date,
                                                  version_suffix="_KBS_REBASED" if price_basis == "research" else "")
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
