"""Independent EOD Challenger lanes; all outputs are research assessments."""
from __future__ import annotations

from hashlib import sha256
from statistics import mean
from typing import Sequence

from .indicators import _rsi, calculate_indicators
from .macd_divergence import _macd_series, _pivots
from .signal_funnel import assess_funnel
from .signal_policy import average_turnover_vnd, order_participation_rate, MIN_AVERAGE_TURNOVER_VND
from .wyckoff import classify_wyckoff_timeframe

VERSION = "v2.0-challenger"
LONG = {"PROBE_BUY", "EARLY_PROBE"}
CODES = ("UPTREND_CORE", "SIDEWAY_RANGE", "ADAPTIVE_FUNNEL", "MACD_EARLY_ZONE", "DOWNTREND_SPRING")


def recovery_status(index_bars: Sequence[dict]) -> dict:
    """Prospective EOD rally attempt; FTD is an observed event, not a guarantee."""
    ordered = sorted(index_bars, key=lambda item: item.get("date") or item["trading_date"])
    if len(ordered) < 35:
        return {"state": "UNKNOWN", "reason": "INDEX_HISTORY_SHORT"}
    start = max(0, len(ordered) - 30)
    low_index = min(range(start, len(ordered)), key=lambda i: float(ordered[i]["low"]))
    day = len(ordered) - low_index
    confirmed = None
    for index in range(low_index + 3, len(ordered)):
        current, prior = ordered[index], ordered[index - 1]
        if (float(current["close"]) >= float(prior["close"]) * 1.01
                and float(current.get("volume") or 0) > float(prior.get("volume") or 0) > 0):
            confirmed = current.get("date") or current["trading_date"]
            break
    return {"state": "FTD_CONFIRMED" if confirmed else "RALLY_ATTEMPT" if day >= 2 else "NEW_LOW",
            "rally_low_date": ordered[low_index].get("date") or ordered[low_index]["trading_date"], "rally_day": day,
            "ftd_date": confirmed, "method": "INDEX_GAIN_1PCT_VOLUME_GT_PREVIOUS_DAY_FROM_DAY4"}


def market_regime(context: dict) -> str:
    index, breadth = context.get("vnindex_snapshot") or {}, context.get("breadth") or {}
    pct = breadth.get("pct_above_sma50")
    if pct is None or breadth.get("coverage_status") == "INCOMPLETE":
        return "UNKNOWN"
    trend = index.get("trend_state")
    if trend not in {"UP", "DOWN", "SIDEWAYS"}:
        return "UNKNOWN"
    if trend == "DOWN" or float(pct) < 30:
        if (trend == "DOWN" and float(pct) >= 40
                and (context.get("recovery") or {}).get("state") == "FTD_CONFIRMED"):
            return "RECOVERY_FTD"
        return "DOWNTREND"
    return "UPTREND" if trend == "UP" and float(pct) >= 40 else "SIDEWAYS"


def early_second_low(bars: Sequence[dict], symbol_id: int) -> dict | None:
    """Current candle is provisional; only the first pivot uses future-confirmed bars."""
    if len(bars) < 50:
        return None
    closes = [float(item["close"]) for item in bars]
    line, histogram = _macd_series(closes)
    today = bars[-1]
    spread = float(today["high"]) - float(today["low"])
    if (histogram[-2] is None or histogram[-1] is None or histogram[-2] > 0 or histogram[-1] <= 0
            or float(today["close"]) <= float(today["open"]) or spread <= 0
            or (float(today["close"]) - float(today["low"])) / spread < .6):
        return None
    second_index = min((len(bars) - 2, len(bars) - 1), key=lambda i: float(bars[i]["low"]))
    second_low = float(bars[second_index]["low"])
    for pivot in reversed(_pivots(bars[:-2])):
        gap = second_index - pivot
        if not 5 <= gap <= 45 or line[pivot] is None or line[-1] is None:
            continue
        first_low = float(bars[pivot]["low"])
        prior_macd = 100 * float(line[pivot]) / float(bars[pivot]["close"])
        current_macd = 100 * float(line[-1]) / closes[-1]
        if (second_low <= first_low * .995 and current_macd >= prior_macd + .2
                and min(float(item["low"]) for item in bars[pivot + 1:second_index]) >= second_low):
            return {"kind": "MACD_SECOND_LOW_CROSS", "stop": second_low * .99,
                    "base": second_low, "first_low_date": bars[pivot]["date"],
                    "second_low_date": bars[second_index]["date"], "confirmation_date": today["date"],
                    "first_low": first_low, "second_low": second_low,
                    "first_macd_pct": round(prior_macd, 4), "second_macd_pct": round(current_macd, 4),
                    "setup_id": sha256(f"{symbol_id}:MACD2:{bars[pivot]['date']}:{bars[second_index]['date']}".encode()).hexdigest()[:24],
                    "provisional_second_pivot": True}
    return None


def oversold_evidence(bars: Sequence[dict]) -> dict:
    closes = [float(item["close"]) for item in bars]
    rsi = _rsi(closes)
    prior = closes[-21:-1]
    mid = mean(prior) if len(prior) == 20 else None
    lower = mid - 2 * mean([(item - mid) ** 2 for item in prior]) ** .5 if mid is not None else None
    band = lower is not None and float(bars[-1]["low"]) <= lower
    return {"rsi14": round(rsi, 2) if rsi is not None else None,
            "prior_lower_band": round(lower, 4) if lower is not None else None,
            "lower_band_breach": band, "oversold": bool(rsi is not None and rsi < 25 or band)}


def sideway_setup(bars: Sequence[dict]) -> dict | None:
    if len(bars) < 21:
        return None
    current, prior = bars[-1], bars[-21:-1]
    support = min(float(item["low"]) for item in prior)
    if float(current["close"]) > max(float(item["high"]) for item in prior):
        return {"kind": "SIDEWAY_BREAKOUT_REJECTED"}
    if not (float(current["low"]) <= support * 1.03
            and float(current["close"]) > max(support, float(current["open"]))):
        return None
    down_volume = [float(item.get("volume") or 0) for item in bars[-11:-1]
                   if float(item["close"]) < float(item["open"])]
    pocket = bool(down_volume and float(current.get("volume") or 0) > max(down_volume))
    return {"kind": "POCKET_PIVOT_AT_BASE" if pocket else "MEAN_REVERSION_SUPPORT",
            "base": support, "stop": min(support, float(current["low"])) * .99,
            "target_return_pct_range": [7, 10], "target_is_research_hypothesis": True}


def uptrend_setup(bars: Sequence[dict]) -> dict | None:
    if len(bars) < 51:
        return None
    current, prior = bars[-1], bars[-21:-1]
    close = float(current["close"])
    high20 = max(float(item["high"]) for item in prior)
    average_volume = mean(float(item.get("volume") or 0) for item in prior)
    if close > high20 and average_volume and float(current.get("volume") or 0) >= 1.3 * average_volume:
        older, middle, recent = bars[-31:-21], bars[-21:-11], bars[-11:-1]
        ranges = [max(float(item["high"]) for item in window) - min(float(item["low"]) for item in window)
                  for window in (older, middle, recent)]
        vcp = (ranges[0] > ranges[1] > ranges[2]
               and mean(float(item.get("volume") or 0) for item in recent)
               < mean(float(item.get("volume") or 0) for item in middle))
        return {"kind": "VCP_BREAKOUT" if vcp else "BREAKOUT_20",
                "base": high20, "stop": min(float(item["low"]) for item in bars[-6:]) * .99}
    ema20 = calculate_indicators(bars).ema20
    if ema20 and float(current["low"]) <= ema20 * 1.01 and close > max(ema20, float(current["open"])):
        return {"kind": "PULLBACK_EMA20", "base": ema20,
                "stop": min(float(item["low"]) for item in bars[-4:]) * .99}
    return None


def assess_challenger_strategies(symbol_id: int, bars: Sequence[dict], market_context: dict,
                                exchange: str | None = None, monthly_state: str | None = None,
                                target_order_value_vnd: float | None = None,
                                champion_action: str = "WATCH") -> list[dict]:
    ordered = sorted(bars, key=lambda item: item["date"])
    if not ordered:
        raise ValueError("challenger requires completed daily bars")
    regime = market_regime(market_context)
    close = float(ordered[-1]["close"])
    liquidity = {"close": close, "volume_avg20": mean(float(item.get("volume") or 0) for item in ordered[-20:])}
    turnover = average_turnover_vnd(liquidity)
    participation = order_participation_rate(float(target_order_value_vnd or 0), liquidity)

    def build(code: str, candidate: dict | None, allowed: bool, fallback: str,
              size: float = 1, detail: dict | None = None) -> dict:
        candidate = candidate or {}
        valid_candidate = bool(candidate.get("stop"))
        action = ("EARLY_PROBE" if code == "MACD_EARLY_ZONE" else "PROBE_BUY") if valid_candidate else "WATCH"
        reasons = [candidate.get("kind") or fallback]
        stop = float(candidate.get("stop") or 0)
        base = float(candidate.get("base") or 0)
        if action in LONG and champion_action in {"EXIT", "REDUCE"}:
            action, reasons = "WATCH", [*reasons, "CHAMPION_EXIT_CONFLICT"]
        if action in LONG and not allowed:
            action, reasons = "WATCH", [*reasons, "REGIME_BLOCKED"]
        if action in LONG and (turnover < MIN_AVERAGE_TURNOVER_VND or participation is not None and participation > .05):
            action, reasons = "WATCH", [*reasons, "HIGH_PARTICIPATION_RISK" if participation is not None and participation > .05 else "INSUFFICIENT_LIQUIDITY"]
        distance = (close / stop - 1) * 100 if stop > 0 else None
        if action in LONG and (distance is None or distance > 8 or distance < 0):
            action, reasons = "WATCH", [*reasons, "CHASE_BLOCKED" if distance is not None else "STOP_UNAVAILABLE"]
        return {"symbol_id": symbol_id, "trading_date": ordered[-1]["date"], "engine_version": VERSION,
                "strategy_code": code, "action": action, "reasons": reasons,
                "base_price": base or None, "distance_to_base_pct": round((close / base - 1) * 100, 2) if base else None,
                "invalidation_price": stop or None,
                "evidence": {"shadow_only": True, "price_basis": "EOD_SIGNAL_NEXT_OPEN_ENTRY",
                             "market_regime": regime, "candidate": candidate, "size_multiplier": size,
                             "regime_evidence": {"vnindex_trend": (market_context.get("vnindex_snapshot") or {}).get("trend_state"),
                                                 "pct_above_sma50": (market_context.get("breadth") or {}).get("pct_above_sma50"),
                                                 "up_down_volume_ratio": (market_context.get("breadth") or {}).get("up_down_volume_ratio"),
                                                 "recovery": market_context.get("recovery")},
                             "max_portfolio_exposure_pct_downtrend": 20 if regime == "DOWNTREND" else None,
                             "average_turnover_20_vnd": round(turnover),
                             "order_participation_rate": round(participation, 6) if participation is not None else None,
                             "distance_to_stop_pct": round(distance, 3) if distance is not None else None,
                             **(detail or {})}}

    up = uptrend_setup(ordered) if regime in {"UPTREND", "RECOVERY_FTD"} else None
    result = [build("UPTREND_CORE", up, regime in {"UPTREND", "RECOVERY_FTD"}, "NO_UPTREND_SETUP",
                    .3 if regime == "RECOVERY_FTD" else 1,
                    {"recovery": market_context.get("recovery")})]
    wyckoff = classify_wyckoff_timeframe("D", ordered, period_event=True) if regime in {"SIDEWAYS", "DOWNTREND"} else {}
    spring = (wyckoff.get("evidence") or {}) if wyckoff.get("event") == "SPRING_TEST" else {}
    side = sideway_setup(ordered) if regime == "SIDEWAYS" else None
    if regime == "SIDEWAYS" and spring.get("support"):
        support = float(spring["support"])
        side = {"kind": "SIDEWAY_SPRING_SUPPORT", "base": support, "stop": support * .99,
                "target_return_pct_range": [7, 10], "target_is_research_hypothesis": True}
    result.append(build("SIDEWAY_RANGE", side, regime == "SIDEWAYS",
                        side.get("kind") if side else "NO_RANGE_SUPPORT_SETUP",
                        detail={"wyckoff_event": wyckoff.get("event")}))

    funnel = assess_funnel(symbol_id, ordered, adaptive=True)
    weekly = (funnel.get("evidence") or {}).get("weekly") or {}
    candidate = ({"kind": "ADAPTIVE_DAILY_TRIGGER", "base": weekly.get("trigger"),
                  "stop": weekly.get("invalidation"), "setup_id": funnel.get("setup_id")}
                 if funnel["stage"] == "DAILY_TRIGGER" else None)
    result.append(build("ADAPTIVE_FUNNEL", candidate, regime in {"UPTREND", "SIDEWAYS", "RECOVERY_FTD"},
                        f"FUNNEL_{funnel['stage']}", .3 if regime in {"SIDEWAYS", "RECOVERY_FTD"} else 1,
                        {"funnel_stage": funnel["stage"], "monthly_state": funnel["monthly_state"],
                         "weekly_setup": funnel.get("setup_kind"), "setup_id": funnel.get("setup_id"),
                         "funnel_reasons": funnel["reasons"]}))

    early = early_second_low(ordered, symbol_id)
    oversold = oversold_evidence(ordered)
    allowed = regime in {"UPTREND", "SIDEWAYS", "RECOVERY_FTD"} or regime == "DOWNTREND" and oversold["oversold"]
    macd = build("MACD_EARLY_ZONE", early, allowed, "NO_SECOND_LOW_MACD_CROSS", .3,
                 {"stage": "EARLY_STAGE" if early else "WATCH", "oversold": oversold,
                  "downtrend_target": "MA20_OR_10_TO_12_PCT" if regime == "DOWNTREND" else None})
    if early and regime == "DOWNTREND" and not oversold["oversold"]:
        macd["reasons"].append("DOWNTREND_OVERSOLD_REQUIRED")
    result.append(macd)
    bounce = None
    if regime == "DOWNTREND" and spring.get("support") and oversold["oversold"]:
        support = float(spring["support"])
        bounce = {"kind": "DOWNTREND_SPRING_BOUNCE", "base": support, "stop": support * .99,
                  "target": "MA20_OR_10_TO_12_PCT", "target_is_research_hypothesis": True}
    result.append(build("DOWNTREND_SPRING", bounce, regime == "DOWNTREND",
                        "NO_OVERSOLD_SPRING", .3,
                        {"oversold": oversold, "wyckoff_event": wyckoff.get("event")}))
    return result


def assess_challenger(symbol_id: int, bars: Sequence[dict], market_context: dict,
                      champion_action: str = "WATCH", champion_reasons: Sequence[str] = (),
                      invalidation_price: float | None = None, exchange: str | None = None,
                      monthly_state: str | None = None, target_order_value_vnd: float | None = None,
                      base_price: float | None = None) -> dict:
    branches = assess_challenger_strategies(symbol_id, bars, market_context, exchange, monthly_state,
                                             target_order_value_vnd, champion_action)
    chosen = next((item for item in branches if item["action"] in LONG), None)
    regime = market_regime(market_context)
    return {"symbol_id": symbol_id, "trading_date": max(item["date"] for item in bars),
            "engine_version": VERSION, "action": chosen["action"] if chosen else "WATCH",
            "reasons": chosen["reasons"] if chosen else ["DOWNTREND_CAPITAL_PRESERVATION" if regime == "DOWNTREND" else "NO_CHALLENGER_TRIGGER"],
            "base_price": chosen["base_price"] if chosen else None,
            "distance_to_base_pct": chosen["distance_to_base_pct"] if chosen else None,
            "invalidation_price": chosen["invalidation_price"] if chosen else None,
            "confidence_score": None,
            "evidence": {"shadow_only": True, "price_basis": "EOD_SIGNAL_NEXT_OPEN_ENTRY",
                         "champion_action": champion_action, "market_regime": regime,
                         "strategy_code": chosen["strategy_code"] if chosen else None,
                         "strategy_actions": {item["strategy_code"]: item["action"] for item in branches},
                         **(chosen["evidence"] if chosen else {})}}
