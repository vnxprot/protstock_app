"""Isolated EOD challenger assessment. Never publishes orders or Champion signals."""

from __future__ import annotations

from typing import Sequence

from .macd_divergence_zones import assess_macd_zone_divergence
from .signal_policy import average_turnover_vnd, order_participation_rate, MIN_AVERAGE_TURNOVER_VND
from .wyckoff import classify_wyckoff_timeframe

VERSION = "v2.0-challenger"
STRATEGY_CODES = ("MACD_EARLY_ZONE", "SIDEWAY_RANGE")
LONG_ACTIONS = {"PROBE_BUY", "ADD", "EARLY_PROBE"}


def assess_challenger_strategies(symbol_id: int, bars: Sequence[dict], market_context: dict,
                                exchange: str | None = None, monthly_state: str | None = None,
                                target_order_value_vnd: float | None = None,
                                champion_action: str = "WATCH") -> list[dict]:
    """Evaluate both research hypotheses independently on completed EOD bars."""
    ordered = sorted(bars, key=lambda row: row["date"])
    if not ordered:
        raise ValueError("challenger strategies require completed daily bars")
    last = ordered[-1]
    close = float(last["close"])
    market = market_context.get("vnindex_snapshot") or {}
    breadth = market_context.get("breadth") or {}
    regime = market.get("trend_state") or "UNKNOWN"
    breadth_pct = breadth.get("pct_above_sma50")
    safe_market = (regime not in {"DOWN", "UNKNOWN"} and monthly_state not in {None, "DOWN", "UNKNOWN"}
                   and breadth_pct is not None and float(breadth_pct) >= 40
                   and breadth.get("coverage_status") != "INCOMPLETE")
    average_volume = sum(float(row.get("volume") or 0) for row in ordered[-20:]) / min(20, len(ordered))
    turnover_snapshot = {"close": close, "volume_avg20": average_volume}
    turnover = average_turnover_vnd(turnover_snapshot)
    participation = order_participation_rate(float(target_order_value_vnd or 0), turnover_snapshot)

    def result(code: str, action: str, reasons: list[str], stop: float = 0,
               base: float = 0, extra: dict | None = None) -> dict:
        evidence = {"shadow_only": True, "price_basis": "EOD_CLOSE", "market_regime": regime,
                    "average_turnover_20_vnd": round(turnover),
                    "order_participation_rate": round(participation, 6) if participation is not None else None,
                    **(extra or {})}
        if action in LONG_ACTIONS and champion_action in {"EXIT", "REDUCE"}:
            action, reasons = "WATCH", [*reasons, "CHAMPION_EXIT_CONFLICT"]
        if action in LONG_ACTIONS and not safe_market:
            action, reasons = "WATCH", [*reasons, "MARKET_SAFETY_GATE"]
        if action in LONG_ACTIONS and (turnover < MIN_AVERAGE_TURNOVER_VND
                                      or participation is not None and participation > .05):
            action = "WATCH"
            reasons = [*reasons, "HIGH_PARTICIPATION_RISK" if participation is not None and participation > .05
                       else "INSUFFICIENT_LIQUIDITY"]
        distance = (close / stop - 1) * 100 if stop > 0 else None
        if action in LONG_ACTIONS and (distance is None or distance > 8):
            action, reasons = "WATCH", [*reasons, "CHASE_BLOCKED" if distance is not None else "STOP_UNAVAILABLE"]
        evidence["distance_to_stop_pct"] = round(distance, 3) if distance is not None else None
        return {"symbol_id": symbol_id, "trading_date": last["date"], "engine_version": VERSION,
                "strategy_code": code, "action": action, "reasons": list(dict.fromkeys(reasons)),
                "base_price": base or None,
                "distance_to_base_pct": round((close / base - 1) * 100, 2) if base > 0 else None,
                "invalidation_price": stop or None, "evidence": evidence}

    macd = next((row for row in assess_macd_zone_divergence(symbol_id, ordered, exchange)
                 if row["stage"] == "CONFIRMED" and row["trigger_date"] == last["date"]
                 and row["evidence"].get("breakout_volume_ratio20") is not None
                 and float(row["evidence"]["breakout_volume_ratio20"]) < 1.3), None)
    macd_result = (result("MACD_EARLY_ZONE", "EARLY_PROBE",
                          ["MACD_EARLY_PRICE_CONFIRMATION", "BREAKOUT_VOLUME_UNCONFIRMED"],
                          float(macd["invalidation_price"]), float(macd.get("trigger_price") or 0),
                          {"setup_id": macd["setup_id"], "risk_tier": "SPECULATIVE", "size_multiplier": .30,
                           "breakout_volume_ratio20": macd["evidence"].get("breakout_volume_ratio20")})
                   if macd else result("MACD_EARLY_ZONE", "WATCH", ["NO_MACD_EARLY_TRIGGER"]))

    wyckoff = classify_wyckoff_timeframe("D", ordered, period_event=True) if regime == "SIDEWAYS" else {}
    support = float((wyckoff.get("evidence") or {}).get("support") or 0)
    prior_high20 = max((float(row["high"]) for row in ordered[-21:-1]), default=close)
    if regime != "SIDEWAYS":
        sideway_result = result("SIDEWAY_RANGE", "WATCH", ["MARKET_NOT_SIDEWAYS"])
    elif wyckoff.get("event") == "SPRING_TEST":
        sideway_result = result("SIDEWAY_RANGE", "PROBE_BUY", ["SIDEWAY_SPRING_SUPPORT"],
                                support, support, {"spring_evidence": wyckoff.get("evidence")})
    elif close > prior_high20:
        sideway_result = result("SIDEWAY_RANGE", "WATCH", ["SIDEWAY_BREAKOUT_REJECTED"])
    else:
        sideway_result = result("SIDEWAY_RANGE", "WATCH", ["NO_RANGE_SUPPORT_SETUP"])
    return [macd_result, sideway_result]


def assess_challenger(symbol_id: int, bars: Sequence[dict], market_context: dict,
                      champion_action: str = "WATCH", champion_reasons: Sequence[str] = (),
                      invalidation_price: float | None = None, exchange: str | None = None,
                      monthly_state: str | None = None, target_order_value_vnd: float | None = None,
                      base_price: float | None = None) -> dict:
    ordered = sorted(bars, key=lambda row: row["date"])
    if not ordered:
        raise ValueError("challenger requires completed daily bars")
    last = ordered[-1]
    close = float(last["close"])
    market = market_context.get("vnindex_snapshot") or {}
    breadth = market_context.get("breadth") or {}
    regime = market.get("trend_state") or "UNKNOWN"
    breadth_pct = breadth.get("pct_above_sma50")
    safe_market = (regime not in {"DOWN", "UNKNOWN"} and monthly_state not in {None, "DOWN", "UNKNOWN"}
                   and breadth_pct is not None
                   and float(breadth_pct) >= 40 and breadth.get("coverage_status") != "INCOMPLETE")
    action = champion_action
    reasons = list(champion_reasons)
    evidence: dict = {"champion_action": champion_action, "market_regime": regime,
                      "price_basis": "EOD_CLOSE", "shadow_only": True}
    stop = float(invalidation_price or 0)
    base = float(base_price or 0)
    macd_rows = assess_macd_zone_divergence(symbol_id, ordered, exchange)
    early = next((row for row in macd_rows if row["stage"] == "CONFIRMED"
                  and row["trigger_date"] == last["date"]
                  and row["evidence"].get("breakout_volume_ratio20") is not None
                  and float(row["evidence"]["breakout_volume_ratio20"]) < 1.3), None)
    if early and safe_market and action not in {"EXIT", "REDUCE"}:
        action = "EARLY_PROBE"
        stop = float(early["invalidation_price"])
        base = float(early.get("trigger_price") or 0)
        reasons = [*reasons, "MACD_EARLY_PRICE_CONFIRMATION", "BREAKOUT_VOLUME_UNCONFIRMED"]
        evidence.update({"risk_tier": "SPECULATIVE", "size_multiplier": 0.30,
                         "setup_id": early["setup_id"], "breakout_volume_ratio20": early["evidence"].get("breakout_volume_ratio20")})
    wyckoff = classify_wyckoff_timeframe("D", ordered, period_event=True)
    if regime == "SIDEWAYS" and action in LONG_ACTIONS:
        prior_high20 = max((float(row["high"]) for row in ordered[-21:-1]), default=close)
        if close > prior_high20 and wyckoff.get("event") != "SPRING_TEST":
            action = "WATCH"
            reasons.append("SIDEWAY_BREAKOUT_REJECTED")
        elif wyckoff.get("event") == "SPRING_TEST":
            evidence["spring_evidence"] = wyckoff.get("evidence")
    if regime == "SIDEWAYS" and action == "WATCH" and wyckoff.get("event") == "SPRING_TEST" and safe_market:
        action = "PROBE_BUY"
        stop = float((wyckoff.get("evidence") or {}).get("support") or 0)
        base = stop
        reasons.append("SIDEWAY_SPRING_SUPPORT")
        evidence["spring_evidence"] = wyckoff.get("evidence")
    if action in LONG_ACTIONS and not safe_market:
        action = "WATCH"
        reasons.append("MARKET_SAFETY_GATE")
    volume_avg20 = sum(float(row.get("volume") or 0) for row in ordered[-20:]) / min(20, len(ordered))
    turnover_snapshot = {"close": close, "volume_avg20": volume_avg20}
    turnover = average_turnover_vnd(turnover_snapshot)
    participation = order_participation_rate(float(target_order_value_vnd or 0), turnover_snapshot)
    evidence["average_turnover_20_vnd"] = round(turnover)
    evidence["order_participation_rate"] = round(participation, 6) if participation is not None else None
    if action in LONG_ACTIONS and (turnover < MIN_AVERAGE_TURNOVER_VND or participation is not None and participation > .05):
        action = "WATCH"
        reasons.append("HIGH_PARTICIPATION_RISK" if participation is not None and participation > .05 else "INSUFFICIENT_LIQUIDITY")
    distance = (close / stop - 1) * 100 if stop > 0 else None
    base_distance = (close / base - 1) * 100 if base > 0 else None
    if action in LONG_ACTIONS and (distance is None or distance > 8):
        action = "WATCH"
        reasons.append("CHASE_BLOCKED" if distance is not None else "STOP_UNAVAILABLE")
    evidence.update({"close": close, "invalidation_price": stop or None,
                     "base_price": base or None,
                     "distance_to_stop_pct": round(distance, 3) if distance is not None else None})
    return {"symbol_id": symbol_id, "trading_date": last["date"], "engine_version": VERSION,
            "action": action, "reasons": list(dict.fromkeys(reasons)), "base_price": base or None,
            "distance_to_base_pct": round(base_distance, 2) if base_distance is not None else None,
            "invalidation_price": stop or None, "confidence_score": None, "evidence": evidence}
