"""RSI setup -> MACD confirmation -> fixed neckline trigger (closed daily bars)."""
from .indicators import _ema_series

PIVOT_RADIUS = 2
SETUP_LIFETIME_BARS = 20


def momentum_series(bars: list[dict]) -> list[dict]:
    """Linear-time RSI/MACD with the same initialization as calculate_indicators."""
    closes = [float(row["close"]) for row in bars]
    fast, slow = _ema_series(closes, 12), _ema_series(closes, 26)
    macd = [a - b for a, b in zip(fast, slow) if a is not None and b is not None]
    signal = _ema_series(macd, 9)
    rsi = [None] * len(closes)
    if len(closes) > 14:
        changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
        gain = sum(max(v, 0) for v in changes[:14]) / 14
        loss = sum(max(-v, 0) for v in changes[:14]) / 14
        rsi[14] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
        for i in range(15, len(closes)):
            gain = (gain * 13 + max(changes[i - 1], 0)) / 14
            loss = (loss * 13 + max(-changes[i - 1], 0)) / 14
            rsi[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return [{"rsi14": rsi[i], "macd_histogram": macd[i - 25] - signal[i - 25] if i >= 25 and signal[i - 25] is not None else None} for i in range(len(closes))]


def evaluate_rsi_macd_confirmation(context: dict) -> tuple[bool, str, list[str]]:
    bars = context.get("bars", [])
    if len(bars) < 35:
        return False, "WATCH", []
    indicators = momentum_series(bars)
    pivots = [i for i in range(max(14, len(bars) - 82), len(bars) - PIVOT_RADIUS)
              if all(float(bars[i]["low"]) < float(bars[j]["low"]) for j in range(i - PIVOT_RADIUS, i + PIVOT_RADIUS + 1) if i != j)]
    for second in reversed(pivots):
        confirmed = second + PIVOT_RADIUS
        if len(bars) - 1 - confirmed > SETUP_LIFETIME_BARS:
            break
        first = next((i for i in reversed(pivots) if 5 <= second - i <= 40), None)
        if first is None:
            continue
        left, right = indicators[first]["rsi14"], indicators[second]["rsi14"]
        stop = float(bars[second]["low"])
        if left is None or right is None or not (stop < float(bars[first]["low"]) and right > left):
            continue
        if not any(z["zone_type"] == "SUPPORT" and float(z.get("strength") or 0) >= 60 and float(z["lower_price"]) <= stop <= float(z["upper_price"]) for z in context.get("zones", [])):
            continue
        trigger = max(float(row["high"]) for row in bars[first + 1:second])
        context["engine_evidence"] = {"pattern_type": "RSI_DIVERGENCE", "evidence_cluster": "RSI_DIVERGENCE", "invalidation_price": stop, "trigger_price": trigger, "first_pivot_date": bars[first]["date"], "second_pivot_date": bars[second]["date"], "setup_confirmed_on": bars[confirmed]["date"], "engine_version": "v1.1"}
        if any(float(row["close"]) < stop for row in bars[confirmed:]):
            return False, "WATCH", ["RSI_SETUP_INVALIDATED"]
        reasons = ["BULLISH_RSI_DIVERGENCE", "SUPPORT_ZONE_STRONG"]
        crossed = False
        for i in range(confirmed, len(bars)):
            previous, current = indicators[i - 1], indicators[i]
            prev_hist, hist = previous["macd_histogram"], current["macd_histogram"]
            if prev_hist is not None and hist is not None and prev_hist <= 0 < hist:
                crossed = True
            if hist is not None and hist <= 0:
                crossed = False
            if crossed and float(bars[i]["close"]) > trigger:
                # A completed setup emits once, not on every subsequent daily bar.
                if i != len(bars) - 1:
                    return False, "WATCH", []
                return True, "PROBE_BUY", [*reasons, "MACD_SIGNAL_CROSS_CONFIRMED", "PRICE_NECKLINE_CONFIRMED"]
        hist, prev_hist = indicators[-1]["macd_histogram"], indicators[-2]["macd_histogram"]
        if hist is not None and prev_hist is not None and hist > prev_hist:
            reasons.append("MACD_HISTOGRAM_IMPROVING")
        wait_reasons = [*reasons, "WAIT_PRICE_TRIGGER" if crossed else "WAIT_MACD_CONFIRMATION"]
        current_close, previous_close = float(bars[-1]["close"]), float(bars[-2]["close"])
        near_now = trigger * .97 <= current_close <= trigger
        near_before = trigger * .97 <= previous_close <= trigger
        just_crossed = crossed and prev_hist is not None and hist is not None and prev_hist <= 0 < hist
        # WATCH only near the fixed trigger, and only for a new setup, MACD
        # transition, or first approach. Do not re-emit the same wait daily.
        noteworthy = near_now and (len(bars) - 1 == confirmed or just_crossed or not near_before)
        return noteworthy, "WATCH", wait_reasons
    return False, "WATCH", []
