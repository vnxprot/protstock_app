"""Reconcile chart evidence before the shared trading policy runs."""

from collections.abc import Sequence


def opposing_structures(patterns: Sequence[dict]) -> dict[str, list[dict]]:
    """Scores rank structures within a direction, never bullish against bearish."""
    return {
        direction: sorted(
            (pattern for pattern in patterns if pattern.get("direction") == direction
             and pattern.get("state") in {"READY", "CONFIRMED"}),
            key=lambda pattern: (pattern.get("state") == "CONFIRMED", float(pattern.get("quality_score") or 0)),
            reverse=True,
        )
        for direction in ("BULLISH", "BEARISH")
    }


def reconcile_proposal(
    action: str, reasons: list[str], *, timeframe: str,
    patterns: Sequence[dict], weekly_patterns: Sequence[dict] = (),
) -> tuple[str, list[str]]:
    """A READY bear warns; a confirmed bear prevents an unhedged new long.

    Risk actions are never demoted.  The same rule applies to every engine, so
    an engine cannot turn contradictory chart evidence into an entry by itself.
    """
    if action not in {"PROBE_BUY", "ADD", "WATCH"}:
        return action, reasons
    evidence = opposing_structures(patterns)
    weekly = opposing_structures(weekly_patterns) if timeframe == "D" else {"BEARISH": []}
    confirmed = [p for p in (*evidence["BEARISH"], *weekly["BEARISH"])
                 if p["state"] == "CONFIRMED" and float(p.get("quality_score") or 0) >= 60]
    ready = [p for p in evidence["BEARISH"] if p["state"] == "READY"]
    extra = []
    if confirmed:
        extra.append("OPPOSING_BEARISH_CONFIRMED")
    elif ready:
        extra.append("OPPOSING_BEARISH_READY")
    if confirmed and action in {"PROBE_BUY", "ADD"}:
        return "WATCH", list(dict.fromkeys([*reasons, "ENTRY_BLOCKED", *extra]))
    return action, list(dict.fromkeys([*reasons, *extra]))
