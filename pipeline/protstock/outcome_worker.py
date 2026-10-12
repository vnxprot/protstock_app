from __future__ import annotations

from datetime import date, timedelta

from .config import Settings
from .outcomes import CANONICAL_CALCULATION_VERSION, evaluate_signal_outcome
from .analysis import ALGORITHM_VERSION
from .price_basis import same_source_window
from .supabase_rest import SupabaseRestClient


def evaluate_pending_outcomes(today: date | None = None) -> dict:
    """Persist outcomes for every source once a 20-trading-session window exists."""
    client = SupabaseRestClient(Settings.from_env())
    counts = {"signals": 0, "outcomes": 0, "pending": 0}
    try:
        cutoff = today or date.today()
        histories = {}
        pending_rows: list[dict] = []
        for signal in client.signals_missing_outcomes(cutoff - timedelta(days=5)):
            if (signal.get("evidence") or {}).get("algorithm_version") != ALGORITHM_VERSION:
                continue
            if (signal.get("evidence") or {}).get("pattern_type") == "MACD_BULLISH_DIVERGENCE":
                continue
            existing = {row["horizon_days"]: row for row in signal.get("signal_outcomes", [])}
            counts["signals"] += 1
            if signal["symbol_id"] not in histories:
                rows = [row for row in client.price_history(signal["symbol_id"], 2600)
                        if row["trading_date"] <= cutoff.isoformat()]
                histories[signal["symbol_id"]] = rows if same_source_window(rows) else []
            history = histories[signal["symbol_id"]]
            entry = next((row for row in history if row["trading_date"] == signal["as_of_date"]), None)
            if entry is None:
                counts["pending"] += 3
                continue
            rows = []
            for horizon in (5, 10, 20):
                outcome = evaluate_signal_outcome(signal, history, horizon,
                                                  price_basis="CANONICAL_EVENT_REBASED")
                if outcome is None:
                    if horizon not in existing or existing[horizon].get("status") != "VALID":
                        counts["pending"] += 1
                    continue
                previous = existing.get(horizon, {})
                if (previous.get("status") != "VALID"
                        or previous.get("calculation_version") != CANONICAL_CALCULATION_VERSION
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
