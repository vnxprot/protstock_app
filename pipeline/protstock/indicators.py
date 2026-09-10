from __future__ import annotations

from dataclasses import dataclass, asdict
from math import sqrt
from typing import Sequence


def _sma(values: Sequence[float], length: int) -> float | None:
    if len(values) < length:
        return None
    return sum(values[-length:]) / length


def _ema_series(values: Sequence[float], length: int) -> list[float | None]:
    if not values:
        return []
    result: list[float | None] = [None] * len(values)
    if len(values) < length:
        return result
    seed = sum(values[:length]) / length
    result[length - 1] = seed
    multiplier = 2 / (length + 1)
    current = seed
    for index in range(length, len(values)):
        current = (values[index] - current) * multiplier + current
        result[index] = current
    return result


def _rsi(values: Sequence[float], length: int = 14) -> float | None:
    if len(values) <= length:
        return None
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]
    gains = [max(change, 0.0) for change in changes]
    losses = [max(-change, 0.0) for change in changes]
    avg_gain = sum(gains[:length]) / length
    avg_loss = sum(losses[:length]) / length
    for gain, loss in zip(gains[length:], losses[length:]):
        avg_gain = ((avg_gain * (length - 1)) + gain) / length
        avg_loss = ((avg_loss * (length - 1)) + loss) / length
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _atr(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float], length: int = 14) -> float | None:
    if len(closes) <= length:
        return None
    true_ranges = [highs[0] - lows[0]]
    for i in range(1, len(closes)):
        true_ranges.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    value = sum(true_ranges[:length]) / length
    for tr in true_ranges[length:]:
        value = ((value * (length - 1)) + tr) / length
    return value


@dataclass(frozen=True)
class IndicatorSnapshot:
    close: float
    sma20: float | None
    sma50: float | None
    sma200: float | None
    ema20: float | None
    ema50: float | None
    rsi14: float | None
    macd: float | None
    macd_signal: float | None
    macd_histogram: float | None
    bollinger_upper: float | None
    bollinger_middle: float | None
    bollinger_lower: float | None
    atr14: float | None
    volume_avg20: float | None
    volume_ratio20: float | None
    ma_stack: bool
    trend_state: str

    def to_dict(self) -> dict[str, float | str | bool | None]:
        return asdict(self)


def calculate_indicators(bars: Sequence[dict]) -> IndicatorSnapshot:
    if not bars:
        raise ValueError("at least one bar is required")
    closes = [float(bar["close"]) for bar in bars]
    highs = [float(bar["high"]) for bar in bars]
    lows = [float(bar["low"]) for bar in bars]
    volumes = [float(bar.get("volume", 0)) for bar in bars]
    ema12 = _ema_series(closes, 12)
    ema26 = _ema_series(closes, 26)
    macd_series: list[float] = []
    for fast, slow in zip(ema12, ema26):
        if fast is not None and slow is not None:
            macd_series.append(fast - slow)
    signal_series = _ema_series(macd_series, 9)
    macd = macd_series[-1] if macd_series else None
    signal = signal_series[-1] if signal_series and signal_series[-1] is not None else None
    middle = _sma(closes, 20)
    deviation = None
    if len(closes) >= 20 and middle is not None:
        deviation = sqrt(sum((value - middle) ** 2 for value in closes[-20:]) / 20)
    sma20, sma50, sma200 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 200)
    trend = "UNKNOWN"
    if sma20 is not None and sma50 is not None:
        trend = "UP" if closes[-1] > sma20 > sma50 else "DOWN" if closes[-1] < sma20 < sma50 else "SIDEWAYS"
    volume_avg = _sma(volumes, 20)
    return IndicatorSnapshot(
        close=closes[-1], sma20=sma20, sma50=sma50, sma200=sma200,
        ema20=_ema_series(closes, 20)[-1], ema50=_ema_series(closes, 50)[-1],
        rsi14=_rsi(closes), macd=macd, macd_signal=signal,
        macd_histogram=(macd - signal) if macd is not None and signal is not None else None,
        bollinger_upper=(middle + 2 * deviation) if middle is not None and deviation is not None else None,
        bollinger_middle=middle,
        bollinger_lower=(middle - 2 * deviation) if middle is not None and deviation is not None else None,
        atr14=_atr(highs, lows, closes), volume_avg20=volume_avg,
        volume_ratio20=(volumes[-1] / volume_avg) if volume_avg else None,
        ma_stack=bool(sma20 is not None and sma50 is not None and sma200 is not None and sma20 > sma50 > sma200),
        trend_state=trend,
    )


def relative_strength(asset_closes: Sequence[float], benchmark_closes: Sequence[float], lookback: int = 63) -> float | None:
    size = min(len(asset_closes), len(benchmark_closes), lookback + 1)
    if size < 2 or asset_closes[-size] == 0 or benchmark_closes[-size] == 0:
        return None
    asset_return = asset_closes[-1] / asset_closes[-size] - 1
    benchmark_return = benchmark_closes[-1] / benchmark_closes[-size] - 1
    return asset_return - benchmark_return
