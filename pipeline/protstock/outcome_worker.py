from __future__ import annotations

from datetime import date, timedelta

from .config import Settings
from .outcomes import evaluate_signal_outcome
from .supabase_rest import SupabaseRestClient


def evaluate_pending_outcomes(today: date | None = None) -> dict:
    """Persist outcomes for every source once a 20-trading-session window exists."""
    client = SupabaseRestClient(Settings.from_env())
    counts = {"signals": 0, "outcomes": 0, "pending": 0}
    try:
        cutoff = today or date.today()
        histories = {}
        for signal in client.signals_missing_outcomes(cutoff - timedelta(days=5)):
            existing = {row["horizon_days"] for row in signal.get("signal_outcomes", [])}
            missing = [horizon for horizon in (5, 10, 20) if horizon not in existing]
            if not missing:
                continue
            counts["signals"] += 1
            if signal["symbol_id"] not in histories:
                histories[signal["symbol_id"]] = [row for row in client.price_history(signal["symbol_id"], 2600) if row.get("trading_date", row.get("date", "")) <= cutoff.isoformat()]
            history = histories[signal["symbol_id"]]
            rows = [outcome for horizon in missing if (outcome := evaluate_signal_outcome(signal, history, horizon))]
            counts["pending"] += len(missing) - len(rows)
            counts["outcomes"] += client.upsert("signal_outcomes", rows, "signal_id,horizon_days")
        return counts
    finally:
        client.close()
