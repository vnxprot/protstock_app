from __future__ import annotations

from datetime import date, timedelta

from .config import Settings
from .outcomes import RESEARCH_CALCULATION_VERSION, evaluate_signal_outcome
from .provider_vnstock import KBS_SOURCE_VERSION
from .supabase_rest import SupabaseRestClient


def evaluate_pending_outcomes(today: date | None = None) -> dict:
    """Persist outcomes for every source once a 20-trading-session window exists."""
    client = SupabaseRestClient(Settings.from_env())
    counts = {"signals": 0, "outcomes": 0, "pending": 0}
    try:
        cutoff = today or date.today()
        histories = {}
        scales = {}
        pending_rows: list[dict] = []
        for signal in client.signals_missing_outcomes(cutoff - timedelta(days=5)):
            existing = {row["horizon_days"]: row for row in signal.get("signal_outcomes", [])}
            counts["signals"] += 1
            if signal["symbol_id"] not in histories:
                status = client.research_price_status(signal["symbol_id"])
                if (status and status["coverage_status"] == "MATCHED"
                        and status["source_version"] == KBS_SOURCE_VERSION):
                    histories[signal["symbol_id"]] = [row for row in client.research_price_history(signal["symbol_id"], 2600)
                                                       if row["trading_date"] <= cutoff.isoformat()
                                                       and row.get("source_version") == KBS_SOURCE_VERSION]
                    scales[signal["symbol_id"]] = {row["trading_date"]: float(row["close"])
                                                    for row in client.price_history(signal["symbol_id"], 2600)}
                else:
                    histories[signal["symbol_id"]] = []
                    scales[signal["symbol_id"]] = {}
            history = histories[signal["symbol_id"]]
            entry = next((row for row in history if row["trading_date"] == signal["as_of_date"]), None)
            raw_close = scales[signal["symbol_id"]].get(signal["as_of_date"])
            if entry is None or not raw_close or raw_close <= 0:
                counts["pending"] += 3
                continue
            scale = float(entry["close"]) / raw_close
            rows = []
            for horizon in (5, 10, 20):
                outcome = evaluate_signal_outcome(signal, history, horizon,
                                                  price_basis="KBS_VENDOR_REBASED",
                                                  invalidation_scale=scale)
                if outcome is None:
                    if horizon not in existing or existing[horizon].get("status") != "VALID":
                        counts["pending"] += 1
                    continue
                previous = existing.get(horizon, {})
                if (previous.get("status") != "VALID"
                        or previous.get("calculation_version") != RESEARCH_CALCULATION_VERSION
                        or previous.get("price_fingerprint") != outcome["price_fingerprint"]):
                    rows.append(outcome)
            pending_rows.extend(rows)
            if len(pending_rows) >= 100:
                counts["outcomes"] += client.upsert("signal_outcomes", pending_rows, "signal_id,horizon_days")
                pending_rows = []
        if pending_rows:
            counts["outcomes"] += client.upsert("signal_outcomes", pending_rows, "signal_id,horizon_days")
        return counts
    finally:
        client.close()
