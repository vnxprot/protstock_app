"""Conservative, explainable Wyckoff context — never a stand-alone buy call."""
from __future__ import annotations

from typing import Sequence


def classify_wyckoff(bars: Sequence[dict]) -> dict:
    """Classify the latest completed trading range from OHLCV only.

    This intentionally recognizes only the high-information events used as
    context: Spring/SOS for accumulation and UTAD/SOW for distribution.
    Ambiguous ranges remain NEUTRAL rather than being forced into a phase.
    """
    if len(bars) < 45:
        return {"state": "NEUTRAL", "event": None, "reasons": ["WYCKOFF_INSUFFICIENT_HISTORY"], "evidence": {}}
    window = list(bars[-41:-1])
    last = bars[-1]
    support = min(float(row["low"]) for row in window)
    resistance = max(float(row["high"]) for row in window)
    average_volume = sum(float(row.get("volume") or 0) for row in window[-20:]) / 20
    close, low, high = float(last["close"]), float(last["low"]), float(last["high"])
    volume = float(last.get("volume") or 0)
    volume_ratio = volume / average_volume if average_volume else 0.0
    evidence = {"support": round(support, 4), "resistance": round(resistance, 4), "volume_ratio20": round(volume_ratio, 3)}

    # A break below range support that closes back inside on restrained supply.
    if low < support * 0.99 and close >= support and volume_ratio <= 1.2:
        return {"state": "ACCUMULATION", "event": "SPRING_TEST", "reasons": ["WYCKOFF_SPRING", "WYCKOFF_LOW_SUPPLY_TEST"], "evidence": evidence}
    # Demand demonstrably controls the range only when it clears the ceiling.
    if close > resistance and volume_ratio >= 1.3:
        return {"state": "ACCUMULATION", "event": "SIGN_OF_STRENGTH", "reasons": ["WYCKOFF_SOS", "WYCKOFF_DEMAND_EXPANSION"], "evidence": evidence}
    # Upthrust after distribution: pierce resistance but reject back into range.
    if high > resistance * 1.01 and close <= resistance and volume_ratio >= 1.3:
        return {"state": "DISTRIBUTION", "event": "UTAD", "reasons": ["WYCKOFF_UTAD", "WYCKOFF_SUPPLY_EXPANSION"], "evidence": evidence}
    # Sign of weakness is a real range break with expanding supply.
    if close < support and volume_ratio >= 1.3:
        return {"state": "DISTRIBUTION", "event": "SIGN_OF_WEAKNESS", "reasons": ["WYCKOFF_SOW", "WYCKOFF_SUPPLY_EXPANSION"], "evidence": evidence}
    return {"state": "NEUTRAL", "event": None, "reasons": [], "evidence": evidence}
