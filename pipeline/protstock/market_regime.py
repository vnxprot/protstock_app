from __future__ import annotations

from typing import Sequence


MIN_BREADTH_COVERAGE_RATIO = 0.95


def _valid_snapshot(snapshot: dict) -> bool:
    return snapshot.get("close") is not None and snapshot.get("sma50") is not None


def build_breadth_membership(
    active_symbols: Sequence[dict], prior_snapshots: Sequence[dict], current_snapshots: Sequence[dict], trading_date: str,
) -> tuple[dict, list[dict]]:
    """Freeze the eligible universe using prior completed data, then audit today's observation.

    A symbol missing today but eligible yesterday remains in the denominator once.
    A long-unavailable symbol never becomes a permanent veto on every new entry.
    """
    active_ids = {item["id"] for item in active_symbols}
    prior_valid = {item["symbol_id"] for item in prior_snapshots if item.get("symbol_id") in active_ids and _valid_snapshot(item)}
    current_by_symbol = {item["symbol_id"]: item for item in current_snapshots if item.get("symbol_id") in active_ids}
    current_valid = {symbol_id for symbol_id, item in current_by_symbol.items() if _valid_snapshot(item)}
    eligible_ids = prior_valid | current_valid
    observed_ids = current_valid
    eligible_count, observed_count = len(eligible_ids), len(observed_ids)
    coverage_ratio = observed_count / eligible_count if eligible_count else None
    if not eligible_count:
        coverage_status = "BOOTSTRAP"
    elif observed_count == eligible_count:
        coverage_status = "COMPLETE"
    elif coverage_ratio is not None and coverage_ratio >= MIN_BREADTH_COVERAGE_RATIO:
        coverage_status = "DEGRADED"
    else:
        coverage_status = "INCOMPLETE"
    membership = []
    for symbol_id in active_ids:
        current = current_by_symbol.get(symbol_id)
        if symbol_id in current_valid:
            status, eligible, observed = "ELIGIBLE", True, True
        elif symbol_id in prior_valid:
            status, eligible, observed = "DATA_MISSING_OR_HALTED", True, False
        elif current is not None:
            status, eligible, observed = "INSUFFICIENT_HISTORY", False, False
        else:
            status, eligible, observed = "NOT_ELIGIBLE", False, False
        membership.append({"trading_date": trading_date, "symbol_id": symbol_id, "status": status, "is_eligible": eligible, "is_observed": observed})
    breadth = compute_breadth([current_by_symbol[symbol_id] for symbol_id in observed_ids])
    return {
        **breadth,
        "universe_size": len(active_ids),
        "eligible_count": eligible_count,
        "observed_count": observed_count,
        "coverage_ratio": coverage_ratio,
        "coverage_status": coverage_status,
    }, membership


def compute_breadth(snapshots: Sequence[dict]) -> dict:
    """Calculate free, point-in-time market health from daily snapshots."""
    eligible = [snapshot for snapshot in snapshots if snapshot.get("sma50") is not None and snapshot.get("close") is not None]
    above = sum(1 for snapshot in eligible if float(snapshot["close"]) > float(snapshot["sma50"]))
    def pct(predicate):
        return sum(1 for snapshot in eligible if predicate(snapshot)) / len(eligible) * 100 if eligible else None
    pct_sma20 = pct(lambda snapshot: snapshot.get("sma20") is not None and float(snapshot["close"]) > float(snapshot["sma20"]))
    pct_sma200 = pct(lambda snapshot: snapshot.get("sma200") is not None and float(snapshot["close"]) > float(snapshot["sma200"]))
    pct_stack = pct(lambda snapshot: bool(snapshot.get("ma_stack")))
    components = [value for value in (pct_sma20, above / len(eligible) * 100 if eligible else None, pct_sma200, pct_stack) if value is not None]
    health_score = round(sum(components) / len(components), 1) if components else None
    health_state = "RISK_ON" if health_score is not None and health_score >= 65 else "RISK_OFF" if health_score is not None and health_score < 35 else "NEUTRAL"
    return {"pct_above_sma50": above / len(eligible) * 100 if eligible else None, "pct_above_sma20": pct_sma20, "pct_above_sma200": pct_sma200, "pct_ma_stack": pct_stack, "market_health_score": health_score, "market_health_state": health_state, "sample_size": len(eligible)}


def regime_ok(breadth: dict | None, vnindex_snapshot: dict | None, min_breadth_pct: float = 40.0) -> tuple[bool, list[str]]:
    """Return whether the prior completed market regime permits new long risk."""
    breadth, vnindex_snapshot = breadth or {}, vnindex_snapshot or {}
    pct_above = breadth.get("pct_above_sma50")
    coverage_status = breadth.get("coverage_status")
    if coverage_status == "INCOMPLETE" or breadth.get("coverage_complete") is False:
        return False, ["BREADTH_COVERAGE_INCOMPLETE"] + (["VNINDEX_DOWNTREND"] if vnindex_snapshot.get("trend_state") == "DOWN" else [])
    if coverage_status == "DEGRADED":
        return True, ["BREADTH_DATA_DEGRADED"]
    breadth_ok = pct_above is not None and float(pct_above) >= min_breadth_pct
    index_ok = vnindex_snapshot.get("trend_state") != "DOWN"
    reasons = (["MARKET_BREADTH_WEAK"] if not breadth_ok else []) + (["VNINDEX_DOWNTREND"] if not index_ok else [])
    return breadth_ok and index_ok, reasons
