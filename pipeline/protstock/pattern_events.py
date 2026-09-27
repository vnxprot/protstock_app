"""Point-in-time lifecycle for confirmed double-bottom structures."""

from collections.abc import Sequence


def double_bottom_first_confirmation(
    bars: Sequence[dict], pattern: dict, *, minimum_bars: int = 25, inclusive_volume: bool = False,
) -> str | None:
    """Return the first eligible close for these *same* confirmed pivots.

    A pivot needs three later bars before it can be known.  Looking only from
    that point avoids backdating an event with information from the future.
    """
    if pattern.get("pattern_type") != "DOUBLE_BOTTOM" or pattern.get("state") != "CONFIRMED":
        return None
    evidence = pattern.get("evidence") or {}
    second = evidence.get("second_pivot")
    neckline = pattern.get("trigger_price")
    if not isinstance(second, int) or neckline is None:
        return None
    start = max(minimum_bars - 1, second + 3, 20)
    for index in range(start, len(bars)):
        previous = bars[index - 20:index]
        average = sum(float(bar.get("volume") or 0) for bar in previous) / 20
        volume = float(bars[index].get("volume") or 0)
        volume_ok = volume >= average * 1.3 if inclusive_volume else volume > average * 1.3
        if average > 0 and volume_ok and float(bars[index]["close"]) > float(neckline):
            return str(bars[index]["date"])
    return None


def annotate_double_bottom_events(bars: Sequence[dict], patterns: list[dict]) -> list[dict]:
    """Keep confirmed structure visible, but mark only its first EOD as new."""
    current_date = str(bars[-1]["date"])
    for pattern in patterns:
        if pattern.get("pattern_type") != "DOUBLE_BOTTOM" or pattern.get("state") != "CONFIRMED":
            continue
        first = double_bottom_first_confirmation(bars, pattern)
        if not first:
            continue
        evidence = {**(pattern.get("evidence") or {}), "first_confirmed_on": first, "new_confirmation": first == current_date}
        pattern["evidence"] = evidence
        pattern["confirmed_at"] = first
        if first != current_date:
            pattern["reasons"] = [reason for reason in pattern.get("reasons", []) if reason not in {"NECKLINE_BREAK", "BREAKOUT_VOLUME", "CANDLESTICK_CONFIRMATION"}]
    return patterns
