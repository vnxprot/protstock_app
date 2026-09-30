from __future__ import annotations

from datetime import date, timedelta

from .config import Settings
from .outcomes import CALCULATION_VERSION, evaluate_signal_outcome
from .supabase_rest import SupabaseRestClient


def evaluate_pending_outcomes(today: date | None = None) -> dict:
    """Persist outcomes for every source once a 20-trading-session window exists."""
    client = SupabaseRestClient(Settings.from_env())
    counts = {"signals": 0, "outcomes": 0, "pending": 0}
    try:
        cutoff = today or date.today()
        histories = {}
        for signal in client.signals_missing_outcomes(cutoff - timedelta(days=5)):
            existing = {row["horizon_days"]: row for row in signal.get("signal_outcomes", [])}
            counts["signals"] += 1
            if signal["symbol_id"] not in histories:
                histories[signal["symbol_id"]] = [row for row in client.price_history(signal["symbol_id"], 2600) if row.get("trading_date", row.get("date", "")) <= cutoff.isoformat()]
            history = histories[signal["symbol_id"]]
            rows = []
            for horizon in (5, 10, 20):
                outcome = evaluate_signal_outcome(signal, history, horizon)
                if outcome is None:
                    if horizon not in existing or existing[horizon].get("status") != "VALID":
                        counts["pending"] += 1
                    continue
                previous = existing.get(horizon, {})
                if (previous.get("status") != "VALID"
                        or previous.get("calculation_version") != CALCULATION_VERSION
                        or previous.get("price_fingerprint") != outcome["price_fingerprint"]):
                    rows.append(outcome)
            if rows:
                counts["outcomes"] += client.upsert("signal_outcomes", rows, "signal_id,horizon_days")
        return counts
    finally:
        client.close()
