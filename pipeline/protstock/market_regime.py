from __future__ import annotations

from typing import Sequence


def compute_breadth(snapshots: Sequence[dict]) -> dict:
    """Calculate breadth from one completed daily snapshot per symbol."""
    eligible = [snapshot for snapshot in snapshots if snapshot.get("sma50") is not None and snapshot.get("close") is not None]
    above = sum(1 for snapshot in eligible if float(snapshot["close"]) > float(snapshot["sma50"]))
    return {"pct_above_sma50": above / len(eligible) * 100 if eligible else None, "sample_size": len(eligible)}


def regime_ok(breadth: dict | None, vnindex_snapshot: dict | None, min_breadth_pct: float = 40.0) -> tuple[bool, list[str]]:
    """Return whether the prior completed market regime permits new long risk."""
    breadth, vnindex_snapshot = breadth or {}, vnindex_snapshot or {}
    pct_above = breadth.get("pct_above_sma50")
    breadth_ok = pct_above is not None and float(pct_above) >= min_breadth_pct
    index_ok = vnindex_snapshot.get("trend_state") != "DOWN"
    reasons = (["MARKET_BREADTH_WEAK"] if not breadth_ok else []) + (["VNINDEX_DOWNTREND"] if not index_ok else [])
    return breadth_ok and index_ok, reasons
