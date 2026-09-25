from __future__ import annotations

from collections import defaultdict
from typing import Sequence


MIN_BREADTH_COVERAGE_RATIO = 0.95


def _valid_snapshot(snapshot: dict) -> bool:
    return snapshot.get("close") is not None and snapshot.get("sma50") is not None


def _pct(items: Sequence[dict], predicate) -> float | None:
    return sum(1 for item in items if predicate(item)) / len(items) * 100 if items else None


def _health_score(snapshots: Sequence[dict], advances: int = 0, declines: int = 0) -> float | None:
    values = [
        _pct(snapshots, lambda item: item.get("sma20") is not None and float(item["close"]) > float(item["sma20"])),
        _pct(snapshots, lambda item: float(item["close"]) > float(item["sma50"])),
        _pct(snapshots, lambda item: item.get("sma200") is not None and float(item["close"]) > float(item["sma200"])),
        _pct(snapshots, lambda item: bool(item.get("ma_stack"))),
        advances / (advances + declines) * 100 if advances + declines else None,
    ]
    usable = [value for value in values if value is not None]
    return round(sum(usable) / len(usable), 1) if usable else None


def _health_state(score: float | None) -> str:
    return "RISK_ON" if score is not None and score >= 65 else "RISK_OFF" if score is not None and score < 35 else "NEUTRAL"


def compute_breadth(snapshots: Sequence[dict], prior_by_symbol: dict | None = None, sector_by_symbol: dict | None = None) -> dict:
    """Calculate point-in-time breadth from stored, free EOD OHLCV fields."""
    eligible = [item for item in snapshots if _valid_snapshot(item)]
    prior_by_symbol, sector_by_symbol = prior_by_symbol or {}, sector_by_symbol or {}
    advances = declines = unchanged = new_high20 = new_low20 = 0
    up_volume = down_volume = 0.0
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in eligible:
        symbol_id = item.get("symbol_id")
        grouped[str(sector_by_symbol.get(symbol_id) or "Khác")].append(item)
        prior = prior_by_symbol.get(symbol_id)
        if prior and prior.get("close") is not None:
            change = float(item["close"]) - float(prior["close"])
            volume = float(item.get("last_volume") or 0)
            if change > 0:
                advances += 1
                up_volume += volume
            elif change < 0:
                declines += 1
                down_volume += volume
            else:
                unchanged += 1
        if item.get("close_high20") is not None and float(item["close"]) >= float(item["close_high20"]):
            new_high20 += 1
        if item.get("close_low20") is not None and float(item["close"]) <= float(item["close_low20"]):
            new_low20 += 1
    score = _health_score(eligible, advances, declines)
    sector_breadth = []
    for sector, members in sorted(grouped.items()):
        sector_advances = sector_declines = 0
        for item in members:
            prior = prior_by_symbol.get(item.get("symbol_id"))
            if prior and prior.get("close") is not None:
                change = float(item["close"]) - float(prior["close"])
                sector_advances += int(change > 0)
                sector_declines += int(change < 0)
        sector_score = _health_score(members, sector_advances, sector_declines)
        sector_breadth.append({
            "sector": sector, "sample_size": len(members),
            "pct_above_sma50": _pct(members, lambda item: float(item["close"]) > float(item["sma50"])),
            "advance_count": sector_advances, "decline_count": sector_declines,
            "market_health_score": sector_score, "market_health_state": _health_state(sector_score),
        })
    return {
        "pct_above_sma50": _pct(eligible, lambda item: float(item["close"]) > float(item["sma50"])),
        "pct_above_sma20": _pct(eligible, lambda item: item.get("sma20") is not None and float(item["close"]) > float(item["sma20"])),
        "pct_above_sma200": _pct(eligible, lambda item: item.get("sma200") is not None and float(item["close"]) > float(item["sma200"])),
        "pct_ma_stack": _pct(eligible, lambda item: bool(item.get("ma_stack"))),
        "market_health_score": score, "market_health_state": _health_state(score), "sample_size": len(eligible),
        "advance_count": advances, "decline_count": declines, "unchanged_count": unchanged,
        "advance_decline_ratio": round(advances / declines, 3) if declines else None,
        "new_high20_count": new_high20, "new_low20_count": new_low20,
        "up_volume": round(up_volume, 2), "down_volume": round(down_volume, 2),
        "up_down_volume_ratio": round(up_volume / down_volume, 3) if down_volume else None,
        "sector_breadth": sector_breadth,
    }


def build_breadth_membership(active_symbols: Sequence[dict], prior_snapshots: Sequence[dict], current_snapshots: Sequence[dict], trading_date: str) -> tuple[dict, list[dict]]:
    """Freeze eligibility from prior completed data and audit today's observation."""
    active_ids = {item["id"] for item in active_symbols}
    prior_valid = {item["symbol_id"] for item in prior_snapshots if item.get("symbol_id") in active_ids and _valid_snapshot(item)}
    current_by_symbol = {item["symbol_id"]: item for item in current_snapshots if item.get("symbol_id") in active_ids}
    current_valid = {symbol_id for symbol_id, item in current_by_symbol.items() if _valid_snapshot(item)}
    eligible_ids, observed_ids = prior_valid | current_valid, current_valid
    eligible_count, observed_count = len(eligible_ids), len(observed_ids)
    coverage_ratio = observed_count / eligible_count if eligible_count else None
    coverage_status = "BOOTSTRAP" if not eligible_count else "COMPLETE" if observed_count == eligible_count else "DEGRADED" if coverage_ratio is not None and coverage_ratio >= MIN_BREADTH_COVERAGE_RATIO else "INCOMPLETE"
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
    prior_by_symbol = {item["symbol_id"]: item for item in prior_snapshots}
    sector_by_symbol = {item["id"]: item.get("sector") for item in active_symbols}
    breadth = compute_breadth([current_by_symbol[symbol_id] for symbol_id in observed_ids], prior_by_symbol, sector_by_symbol)
    return {**breadth, "universe_size": len(active_ids), "eligible_count": eligible_count, "observed_count": observed_count, "coverage_ratio": coverage_ratio, "coverage_status": coverage_status}, membership


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
