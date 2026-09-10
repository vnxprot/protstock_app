from __future__ import annotations


def is_bullish_engulfing(previous: dict, current: dict) -> bool:
    return float(previous["close"]) < float(previous["open"]) and float(current["close"]) > float(current["open"]) and float(current["open"]) <= float(previous["close"]) and float(current["close"]) >= float(previous["open"])


def is_pin_bar(bar: dict, direction: str | None = None) -> bool:
    high, low, open_, close = (float(bar[key]) for key in ("high", "low", "open", "close"))
    spread = high - low
    if spread <= 0:
        return False
    body = abs(close - open_)
    lower_wick, upper_wick = min(open_, close) - low, high - max(open_, close)
    if direction == "BULLISH":
        return lower_wick >= spread * 0.55 and body <= spread * 0.3
    if direction == "BEARISH":
        return upper_wick >= spread * 0.55 and body <= spread * 0.3
    return max(lower_wick, upper_wick) >= spread * 0.55 and body <= spread * 0.3


def is_doji(bar: dict, max_body_pct: float = 0.1) -> bool:
    spread = float(bar["high"]) - float(bar["low"])
    return spread > 0 and abs(float(bar["close"]) - float(bar["open"])) / spread <= max_body_pct
