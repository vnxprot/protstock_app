"""Research replay for MACD divergence; never publishes live actions."""

from __future__ import annotations

from datetime import date

from .config import Settings
from .macd_divergence import assess_macd_divergence
from .provider_vnstock import KBS_SOURCE_VERSION
from .supabase_rest import SupabaseRestClient


ASSUMPTION_VERSION = "NEXT_OPEN_FEE15BP_TAX10BP_SLIP10BP_V1"


def _outcome(symbol_id: int, assessment: dict, bars: list[dict], trigger_index: int,
             horizon: int) -> dict | None:
    entry_index = trigger_index + 1
    exit_index = entry_index + horizon - 1
    if exit_index >= len(bars):
        return None
    window = bars[trigger_index:exit_index + 1]
    if any(row.get("quality_status") != "VALID" or row.get("source_version") != KBS_SOURCE_VERSION
           for row in window):
        return None
    entry = float(bars[entry_index]["open"]) * 1.001
    exit_price = float(bars[exit_index]["close"]) * .999
    if entry <= 0:
        return None
    net = exit_price * (1 - .0015 - .001) / (entry * (1 + .0015)) - 1
    peak, drawdown = entry, 0.0
    for bar in bars[entry_index:exit_index + 1]:
        close = float(bar["close"])
        peak = max(peak, close)
        drawdown = min(drawdown, close / peak - 1)
    return {"symbol_id": symbol_id, "setup_id": assessment["setup_id"],
            "oscillator": assessment["oscillator"],
            "trigger_date": assessment["trigger_date"], "horizon_days": horizon,
            "entry_date": bars[entry_index]["trading_date"], "entry_price": round(entry, 4),
            "exit_date": bars[exit_index]["trading_date"], "exit_price": round(exit_price, 4),
            "net_return": round(net, 6), "max_drawdown": round(drawdown, 6),
            "source_version": KBS_SOURCE_VERSION,
            "assumption_version": ASSUMPTION_VERSION}


def replay_macd_symbol(symbol_id: int, rows: list[dict], start_date: date,
                       end_date: date) -> tuple[list[dict], list[dict]]:
    if any(row.get("quality_status") != "VALID" or row.get("source_version") != KBS_SOURCE_VERSION
           for row in rows if row["trading_date"] <= end_date.isoformat()):
        return [], []
    daily = sorted(({**row, "date": row["trading_date"]} for row in rows
                    if row["trading_date"] <= end_date.isoformat()), key=lambda row: row["date"])
    assessments, outcomes = [], []
    seen: dict[str, tuple[str, str]] = {}
    emitted: set[tuple[str, str]] = set()
    for index, bar in enumerate(daily):
        if not start_date.isoformat() <= bar["date"] <= end_date.isoformat():
            continue
        if bar.get("quality_status") != "VALID":
            continue
        for assessment in assess_macd_divergence(symbol_id, daily[:index + 1]):
            assessment["version"] += "_KBS_REBASED"
            key = assessment["oscillator"]
            state = (assessment["setup_id"], assessment["stage"])
            if seen.get(key) != state or index == len(daily) - 1:
                assessments.append(assessment)
                seen[key] = state
            trigger_key = (assessment["setup_id"], key)
            if (assessment["stage"] == "CONFIRMED"
                    and assessment["trigger_date"] == bar["date"]
                    and trigger_key not in emitted):
                emitted.add(trigger_key)
                for horizon in (5, 10, 20):
                    outcome = _outcome(symbol_id, assessment, daily, index, horizon)
                    if outcome is not None:
                        outcomes.append(outcome)
    return assessments, outcomes


def run_macd_replay(start_date: date, end_date: date, *, symbol_offset: int = 0,
                    symbol_limit: int | None = None, symbols: set[str] | None = None,
                    apply: bool = False) -> dict:
    client = SupabaseRestClient(Settings.from_env())
    totals = {"symbols": 0, "assessments": 0, "confirmed": 0,
              "outcomes": 0, "missing_price_series": 0,
              "mode": "apply" if apply else "dry-run"}
    try:
        candidates = client.all_symbols_for_replay()
        if symbols:
            candidates = [item for item in candidates if item["symbol"] in symbols]
        else:
            candidates = candidates[symbol_offset:]
            if symbol_limit is not None:
                candidates = candidates[:symbol_limit]
        for item in candidates:
            status = client.research_price_status(item["id"])
            if (not status or status["coverage_status"] != "MATCHED"
                    or status["requested_start_date"] > start_date.isoformat()
                    or status["requested_end_date"] < end_date.isoformat()):
                totals["missing_price_series"] += 1
                continue
            rows = client.research_price_history(item["id"], 2600)
            if not rows:
                totals["missing_price_series"] += 1
                continue
            assessments, outcomes = replay_macd_symbol(item["id"], rows, start_date, end_date)
            totals["symbols"] += 1
            totals["assessments"] += len(assessments)
            totals["confirmed"] += sum(row["stage"] == "CONFIRMED" for row in assessments)
            totals["outcomes"] += len(outcomes)
            if apply:
                for offset in range(0, len(assessments), 100):
                    client.upsert("macd_divergence_assessments", assessments[offset:offset + 100],
                                  "symbol_id,as_of_date,version,oscillator")
                for offset in range(0, len(outcomes), 100):
                    client.upsert("macd_divergence_outcomes", outcomes[offset:offset + 100],
                                  "symbol_id,setup_id,oscillator,horizon_days")
        return totals
    finally:
        client.close()
