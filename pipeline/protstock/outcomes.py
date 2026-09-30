from __future__ import annotations

from typing import Sequence
from hashlib import sha256
import json


CALCULATION_VERSION = "OUTCOME_V2_PRICE_FINGERPRINT"


def evaluate_signal_outcome(signal: dict, price_history: Sequence[dict], horizon_days: int) -> dict | None:
    """Evaluate one already-known signal without changing live signal thresholds."""
    ordered = sorted(price_history, key=lambda row: row.get("trading_date", row.get("date", "")))
    as_of_date = signal["as_of_date"]
    entry_bar = next((row for row in reversed(ordered) if row.get("trading_date", row.get("date")) == as_of_date), None)
    future = [row for row in ordered if row.get("trading_date", row.get("date")) > as_of_date][:horizon_days]
    if entry_bar is None or len(future) < horizon_days:
        return None
    window = [entry_bar, *future]
    if any(row.get("quality_status", "VALID") != "VALID" or float(row["close"]) <= 0 for row in window):
        return None
    for left, right in zip(window, window[1:]):
        ratio = float(right["close"]) / float(left["close"])
        if ratio <= 0.5 or ratio >= 2:
            return None
    invalidation = signal.get("invalidation_price") or (signal.get("evidence") or {}).get("invalidation_price")
    fingerprint = sha256(json.dumps({"bars": [
        [row.get("trading_date", row.get("date")), row["close"], row.get("low"),
         row.get("source"), row.get("source_version"), row.get("price_unit")]
        for row in window
    ], "invalidation": invalidation}, sort_keys=True, default=str).encode()).hexdigest()
    entry_price = float(entry_bar["close"])
    peak, max_drawdown = entry_price, 0.0
    hit_invalidation = False
    for row in future:
        low, close = float(row.get("low", row["close"])), float(row["close"])
        hit_invalidation = hit_invalidation or (invalidation is not None and low < float(invalidation))
        peak = max(peak, close)
        max_drawdown = min(max_drawdown, close / peak - 1)
    return {
        "signal_id": signal["id"],
        "horizon_days": horizon_days,
        "forward_return_pct": float(future[-1]["close"]) / entry_price - 1,
        "max_drawdown_pct": max_drawdown,
        "hit_invalidation": hit_invalidation,
        "status": "VALID",
        "calculation_version": CALCULATION_VERSION,
        "price_fingerprint": fingerprint,
    }
