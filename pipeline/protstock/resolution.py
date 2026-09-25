from __future__ import annotations

from datetime import date, timedelta
from typing import Any


ACTION_PRIORITY = {"EXIT": 5, "REDUCE": 4, "ADD": 3, "PROBE_BUY": 2, "WATCH": 1}
CONFLUENCE = {1: (70, "STANDARD"), 2: (90, "HIGH_CONFLUENCE")}

def classify_signal_state(action: str, reasons: list[str], evidence: dict[str, Any] | None = None) -> str:
    """Keep a watch setup distinct from a blocked or informational observation."""
    if action != "WATCH":
        return "ACTIONABLE"
    codes = set(reasons)
    evidence = evidence or {}
    # A blocked entry is context, never a quality watch candidate.
    if "ENTRY_BLOCKED" in codes or "NO_OPEN_POSITION" in codes:
        return "WATCH_CONTEXT"
    if "RSI_NOT_ELIGIBLE" in codes:
        return "EXTENDED"
    if any(code.startswith(("NEAR_TRIGGER_", "V0_NEAR_")) or "SETUP" in code or "READY" in code or "WAIT_" in code for code in codes):
        return "WATCH_SETUP"
    if "RELATIVE_STRENGTH_GT_5PCT" in codes or "STOCK_UPTREND" in codes:
        return "MOMENTUM_CONTINUATION"
    return "WATCH_CONTEXT"


def _setup_expiry(as_of_date: str | date, evidence: dict[str, Any]) -> str | None:
    """Turn a short setup lifetime into a deterministic business-date label."""
    sessions = int(evidence.get("setup_expiry_sessions") or 0)
    if not sessions:
        return None
    day = date.fromisoformat(as_of_date) if isinstance(as_of_date, str) else as_of_date
    while sessions:
        day += timedelta(days=1)
        if day.weekday() < 5:
            sessions -= 1
    return day.isoformat()


def resolve_consolidated_signal(raw_signals: list[dict[str, Any]]) -> dict[str, Any]:
    """Choose one action while retaining the engines that agree with it.

    Raw signal rows remain untouched for audit/backtest.  Only engines producing
    the winning action count as confluence; opposing actions are resolved by the
    risk-first action ladder instead of being falsely counted as agreement.
    """
    if not raw_signals:
        raise ValueError("raw_signals cannot be empty")
    winner = max(raw_signals, key=lambda signal: ACTION_PRIORITY.get(str(signal.get("action")), 0))
    action = str(winner["action"])
    agreeing = [signal for signal in raw_signals if signal.get("action") == action]
    engines = list(dict.fromkeys(str(signal.get("engine") or signal.get("rule_name") or "Unknown engine") for signal in agreeing))
    clusters = {str((signal.get("evidence") or {}).get("evidence_cluster") or f"engine:{signal.get('engine') or signal.get('rule_name') or 'unknown'}") for signal in agreeing}
    count = len(clusters)
    score, badge = CONFLUENCE.get(count, (98, "STRONG_ALIGNED"))
    reasons = list(dict.fromkeys(reason for signal in agreeing for reason in (signal.get("reasons") or [])))
    evidence = next((signal.get("evidence") or {} for signal in agreeing if (signal.get("evidence") or {}).get("trigger_price") is not None), agreeing[0].get("evidence") or {})
    as_of_date = str(winner.get("as_of_date") or "")
    return {
        "composite_action": action,
        "confluence_score": score,
        "confluence_count": count,
        "confluence_badge": badge,
        "consensus_engines": engines,
        "reasons": reasons,
        "signal_state": classify_signal_state(action, reasons, evidence),
        **({"trigger_price": evidence.get("trigger_price"), "invalidation_price": evidence.get("invalidation_price"), "expiry_date": _setup_expiry(as_of_date, evidence) if as_of_date else None} if evidence.get("trigger_price") is not None or evidence.get("invalidation_price") is not None else {}),
    }
