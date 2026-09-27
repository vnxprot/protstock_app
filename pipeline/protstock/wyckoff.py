"""Conservative, explainable Wyckoff context — never a stand-alone buy call."""
from __future__ import annotations

from typing import Sequence


def classify_wyckoff(bars: Sequence[dict]) -> dict:
    """Recognize one price/volume event, not an entire Wyckoff phase."""
    if len(bars) < 45:
        return {"state": "NEUTRAL", "event": None, "reasons": ["WYCKOFF_INSUFFICIENT_HISTORY"], "evidence": {}}
    window = list(bars[-42:-2])
    candidate, last = bars[-2], bars[-1]
    support = min(float(row["low"]) for row in window)
    resistance = max(float(row["high"]) for row in window)
    average_volume = sum(float(row.get("volume") or 0) for row in window[-20:]) / 20
    close, low, high, open_price = (float(candidate[key]) for key in ("close", "low", "high", "open"))
    confirmed_close, confirmed_low, confirmed_high = (float(last[key]) for key in ("close", "low", "high"))
    volume = float(candidate.get("volume") or 0)
    volume_ratio = volume / average_volume if average_volume else 0.0
    width_pct = (resistance / support - 1) * 100 if support > 0 else float("inf")
    support_touches = sum(float(row["low"]) <= support * 1.03 for row in window)
    resistance_touches = sum(float(row["high"]) >= resistance * 0.97 for row in window)
    clv = (close - low) / (high - low) if high > low else 0.5
    evidence = {
        "support": round(support, 4), "resistance": round(resistance, 4),
        "volume_ratio20": round(volume_ratio, 3), "range_width_pct": round(width_pct, 2),
        "support_touches": support_touches, "resistance_touches": resistance_touches,
        "clv": round(clv, 3), "event_date": candidate["date"],
        "confirmed_on": last["date"],
    }
    # A broad trend or a one-touch extreme is not a confirmed trading range.
    if not (5 <= width_pct <= 35 and support_touches >= 2 and resistance_touches >= 2 and average_volume > 0):
        return {"state": "NEUTRAL", "event": None, "reasons": [], "evidence": evidence}

    if low < support * 0.99 and close >= support and clv >= 0.65 and volume_ratio <= 0.85 and confirmed_low > low and confirmed_close >= close:
        return {"state": "BULLISH_CONTEXT", "event": "SPRING_TEST", "reasons": ["WYCKOFF_SPRING"], "evidence": evidence}
    if close > resistance and close > open_price and clv >= 0.7 and volume_ratio >= 1.3 and confirmed_close > resistance:
        return {"state": "BULLISH_CONTEXT", "event": "SIGN_OF_STRENGTH", "reasons": ["WYCKOFF_SOS"], "evidence": evidence}
    if high > resistance * 1.01 and close <= resistance and clv <= 0.35 and volume_ratio >= 1.3 and confirmed_high < high and confirmed_close <= resistance:
        return {"state": "BEARISH_CONTEXT", "event": "UTAD", "reasons": ["WYCKOFF_UTAD"], "evidence": evidence}
    if close < support and close < open_price and clv <= 0.3 and volume_ratio >= 1.3 and confirmed_close < support:
        return {"state": "BEARISH_CONTEXT", "event": "SIGN_OF_WEAKNESS", "reasons": ["WYCKOFF_SOW"], "evidence": evidence}
    return {"state": "NEUTRAL", "event": None, "reasons": [], "evidence": evidence}


def classify_wyckoff_timeframe(timeframe: str, bars: Sequence[dict], *, period_event: bool = False) -> dict:
    """Daily events use daily bars; weekly events use the last closed weekly bar once."""
    if timeframe == "D":
        result = classify_wyckoff(bars)
    elif timeframe == "W" and period_event:
        result = classify_wyckoff([bar for bar in bars if bar.get("is_complete")])
    else:
        return {"state": "NEUTRAL", "event": None, "reasons": [], "evidence": {}}
    if result["event"]:
        result["evidence"] = {**result["evidence"], "timeframe": timeframe}
    return result
