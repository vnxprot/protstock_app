from __future__ import annotations

from typing import Sequence

from .indicators import calculate_indicators, relative_strength
from .market_regime import regime_ok
from .patterns import detect_patterns
from .rules import multi_timeframe_gate
from .risk import DEFAULT_MAX_SECTOR_WEIGHT_PCT, invalidation_width_warning, portfolio_exposure, position_size
from .zones import detect_zones, zone_confluence_bonus


ALGORITHM_VERSION = "core-rules-v2"


def analyze_bars(bars: Sequence[dict], position: dict | None = None, weekly_patterns: list[dict] | None = None, monthly_snapshot: dict | None = None, benchmark_rows: Sequence[dict] | None = None, market_context: dict | None = None, portfolio_positions: list[dict] | None = None, candidate_sector: str | None = None, capital: float | None = None) -> dict:
    if not bars:
        raise ValueError("bars cannot be empty")
    ordered = sorted(bars, key=lambda item: item["date"])
    snapshot = calculate_indicators(ordered)
    patterns = detect_patterns(ordered)
    zones = detect_zones(ordered)
    snapshot_dict = snapshot.to_dict()
    if benchmark_rows is not None:
        benchmark_by_date = {item["date"]: float(item["close"]) for item in benchmark_rows}
        aligned = [(float(item["close"]), benchmark_by_date[item["date"]]) for item in ordered if item["date"] in benchmark_by_date]
        snapshot_dict["relative_strength_market"] = relative_strength([item[0] for item in aligned], [item[1] for item in aligned]) if aligned else None
    pattern_dicts = _apply_zone_confluence([{**item.to_dict(), "start_date": ordered[item.start_index]["date"]} for item in patterns], zones)
    multi_timeframe_context = {"weekly_patterns": weekly_patterns or [], "monthly_snapshot": monthly_snapshot or {}} if weekly_patterns is not None or monthly_snapshot is not None else None
    signal, reasons = resolve_signal(pattern_dicts, snapshot_dict, position, market_context=market_context, multi_timeframe_context=multi_timeframe_context, portfolio_positions=portfolio_positions, candidate_sector=candidate_sector, capital=capital)
    reasons = [f"TREND_{snapshot.trend_state}", *reasons]
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "as_of_date": ordered[-1]["date"],
        "indicators": snapshot_dict,
        "patterns": pattern_dicts,
        "zones": zones,
        "signal_preview": signal,
        "reasons": reasons,
    }


def resolve_signal(patterns: list[dict], snapshot: dict, position: dict | None = None, *, market_context: dict | None = None, multi_timeframe_context: dict | None = None, zones: Sequence[dict] | None = None, portfolio_positions: list[dict] | None = None, candidate_sector: str | None = None, capital: float | None = None, max_sector_weight_pct: float = DEFAULT_MAX_SECTOR_WEIGHT_PCT) -> tuple[str, list[str]]:
    if zones is not None:
        patterns = _apply_zone_confluence(patterns, zones)
    if position and snapshot.get("close", 0) < position["invalidation_price"]:
        return "EXIT", ["INVALIDATION_BROKEN"]
    bear = [p for p in patterns if p["direction"] == "BEARISH" and p["state"] == "CONFIRMED" and p["quality_score"] >= 60]
    if bear and position:
        return "REDUCE", [f"PATTERN_{p['pattern_type']}_CONFIRMED" for p in bear]
    bull = [p for p in patterns if p["direction"] == "BULLISH" and p["state"] == "CONFIRMED"]
    top = max(bull, key=lambda p: p["quality_score"], default=None)
    liquid = (snapshot.get("volume_avg20") or 0) * (snapshot.get("close") or 0) >= 300_000_000
    bonus = snapshot.get("ma_stack") or (snapshot.get("relative_strength_market") or 0) > 0
    threshold = 65 if bonus else 70
    if top and top["quality_score"] >= threshold and snapshot.get("trend_state") in ("UP", "SIDEWAYS") and (snapshot.get("volume_ratio20") or 0) >= 1.3 and (snapshot.get("rsi14") or 100) < 75 and liquid:
        reasons = [f"PATTERN_{top['pattern_type']}_CONFIRMED", "VOLUME_CONFIRMED", "LIQUIDITY_OK"]
        warning = invalidation_width_warning(snapshot.get("close", 0), top.get("invalidation_price") or 0, snapshot.get("atr14"))
        if warning: reasons.append(warning)
        action = "PROBE_BUY" if not position else ("ADD" if str(top.get("start_date", "")) > str(position.get("entry_date", "")) else "WATCH")
        return _apply_long_gates(action, reasons, multi_timeframe_context, market_context, portfolio_positions, candidate_sector, capital, snapshot, top, max_sector_weight_pct)
    ready = [p for p in patterns if p["state"] == "READY"]
    return "WATCH", [f"NEAR_TRIGGER_{p['pattern_type']}" for p in ready[:2]]


def _apply_long_gates(action: str, reasons: list[str], multi_timeframe_context: dict | None, market_context: dict | None, portfolio_positions: list[dict] | None, candidate_sector: str | None, capital: float | None, snapshot: dict, pattern: dict, max_sector_weight_pct: float) -> tuple[str, list[str]]:
    if action not in {"PROBE_BUY", "ADD"}:
        return action, reasons
    gated_reasons = list(reasons)
    if multi_timeframe_context is not None:
        ok, gate_reasons = multi_timeframe_gate(multi_timeframe_context)
        gated_reasons.extend(gate_reasons)
        if not ok:
            return "WATCH", gated_reasons
    if market_context is not None:
        ok, gate_reasons = regime_ok(market_context.get("breadth"), market_context.get("vnindex_snapshot"))
        gated_reasons.extend(gate_reasons)
        if not ok:
            return "WATCH", gated_reasons
    if portfolio_positions is not None and candidate_sector and capital and capital > 0:
        if _projected_sector_weight(portfolio_positions, candidate_sector, capital, snapshot, pattern) > max_sector_weight_pct:
            return "WATCH", [*gated_reasons, "SECTOR_CONCENTRATION_LIMIT"]
    return action, gated_reasons


def _projected_sector_weight(positions: list[dict], candidate_sector: str, capital: float, snapshot: dict, pattern: dict) -> float:
    """Size the candidate by risk, then reuse the portfolio exposure aggregation."""
    exposure = portfolio_exposure(positions, capital)
    sizing = position_size(capital, 1.0, float(snapshot["close"]), float(pattern["invalidation_price"]), snapshot.get("atr14"))
    candidate_value = min(float(sizing["position_value"]), capital)
    existing_sector_value = exposure["total_value"] * exposure["sector_weights"].get(candidate_sector, 0) / 100
    projected_total = exposure["total_value"] + candidate_value
    return (existing_sector_value + candidate_value) / projected_total * 100 if projected_total else 0.0


def _apply_zone_confluence(patterns: Sequence[dict], zones: Sequence[dict]) -> list[dict]:
    enriched: list[dict] = []
    for pattern in patterns:
        if pattern.get("state") != "CONFIRMED" or pattern.get("direction") not in {"BULLISH", "BEARISH"}:
            enriched.append(pattern)
            continue
        bonus, reason = zone_confluence_bonus(float(pattern.get("trigger_price") or 0), pattern["direction"], zones)
        if not reason:
            enriched.append(pattern)
            continue
        enriched.append({**pattern, "quality_score": min(100.0, float(pattern["quality_score"]) + bonus), "reasons": [*(pattern.get("reasons") or []), reason], "evidence": {**(pattern.get("evidence") or {}), "zone_confluence_bonus": bonus}})
    return enriched
