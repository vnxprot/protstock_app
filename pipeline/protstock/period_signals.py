"""Confirmed higher-timeframe events; never backdate to an unconfirmed pivot."""
from .indicators import _ema_series


def monthly_trend(bars: list[dict]) -> dict:
    closes = [float(row["close"]) for row in bars]
    if len(closes) < 20:
        return {"trend_state": "UNKNOWN"}
    ema10 = _ema_series(closes, 10)[-1]
    sma20 = sum(closes[-20:]) / 20
    state = "UP" if closes[-1] > ema10 > sma20 else "DOWN" if closes[-1] < ema10 < sma20 else "SIDEWAYS"
    return {"trend_state": state, "ema10": ema10, "sma20": sma20}


def evaluate_period_signal(timeframe: str, context: dict) -> tuple[bool, str, list[str]]:
    bars = [bar for bar in context["bars"] if bar.get("is_complete")]
    if not bars or not context.get("period_event"):
        return False, "WATCH", []
    latest = bars[-1]
    context["engine_evidence"] = {"period_source_date": latest["date"], "confirmed_on": context["evaluation_date"], "timeframe": timeframe}
    if timeframe == "M":
        current, prior = monthly_trend(bars), monthly_trend(bars[:-1])
        state = current["trend_state"]
        if state == "UNKNOWN" or state == prior["trend_state"]:
            return False, "WATCH", []
        return True, "REDUCE" if state == "DOWN" and context.get("position") else "WATCH", [f"MONTHLY_TREND_CHANGED_{state}", "CLOSED_PERIOD_ONLY"]
    if len(bars) < 21:
        return False, "WATCH", []
    close = float(latest["close"])
    resistance = max(float(bar["high"]) for bar in bars[-14:-1])
    volume_average = sum(float(bar["volume"]) for bar in bars[-14:-1]) / 13
    ema20 = _ema_series([float(bar["close"]) for bar in bars], 20)[-1]
    stop = min(float(bar["low"]) for bar in bars[-4:])
    context["engine_evidence"].update(pattern_type="WEEKLY_BREAKOUT_13", trigger_price=resistance, invalidation_price=stop, evidence_cluster="WEEKLY_BREAKOUT_13")
    if close > resistance and volume_average > 0 and float(latest["volume"]) >= 1.3 * volume_average:
        return True, "PROBE_BUY", ["WEEKLY_BREAKOUT_13_CONFIRMED", "CLOSED_PERIOD_ONLY"]
    if float(latest["low"]) <= ema20 < close and close > float(latest["open"]):
        return True, "WATCH", ["WEEKLY_PULLBACK_EMA20_SETUP", "CLOSED_PERIOD_ONLY"]
    return False, "WATCH", []
