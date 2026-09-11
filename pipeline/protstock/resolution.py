from __future__ import annotations

from typing import Any


ACTION_PRIORITY = {"EXIT": 5, "REDUCE": 4, "ADD": 3, "PROBE_BUY": 2, "WATCH": 1}
CONFLUENCE = {1: (70, "STANDARD"), 2: (90, "HIGH_CONFLUENCE")}


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
    count = len(engines)
    score, badge = CONFLUENCE.get(count, (98, "STRONG_ALIGNED"))
    reasons = list(dict.fromkeys(reason for signal in agreeing for reason in (signal.get("reasons") or [])))
    return {
        "composite_action": action,
        "confluence_score": score,
        "confluence_count": count,
        "confluence_badge": badge,
        "consensus_engines": engines,
        "reasons": reasons,
    }
