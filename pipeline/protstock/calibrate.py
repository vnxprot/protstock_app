from __future__ import annotations

from statistics import mean
from typing import Callable, Sequence

from .backtest import run_backtest, walk_forward_windows

# Deliberately small and explicit: research is manual, not a generic optimizer.
VOLUME_MULTIPLIERS = (1.2, 1.4, 1.6)
QUALITY_THRESHOLDS = (60, 65, 70)


def calibration_rule(pattern_type: str, volume_multiplier: float, quality_threshold: int) -> dict:
    return {
        "version": 1,
        "action": "PROBE_BUY",
        "timeframe": "D",
        "all": [
            {"metric": "pattern", "op": "confirmed", "type": pattern_type},
            {"metric": "volume_ratio20", "op": ">", "value": volume_multiplier},
        ],
        "research_quality_threshold": quality_threshold,
    }


def calibrate_pattern(bars: Sequence[dict], pattern_type: str, *, train_bars: int = 504, test_bars: int = 126, runner: Callable = run_backtest) -> dict:
    """Choose a fixed-grid parameter set exclusively by out-of-sample results."""
    windows = walk_forward_windows(len(bars), train_bars, test_bars)
    if not windows:
        raise ValueError("insufficient bars for a walk-forward window")
    candidates: list[dict] = []
    for volume_multiplier in VOLUME_MULTIPLIERS:
        for quality_threshold in QUALITY_THRESHOLDS:
            rule = calibration_rule(pattern_type, volume_multiplier, quality_threshold)
            train_metrics = [runner([bars[index] for index in train], rule)["metrics"] for train, _ in windows]
            test_metrics = [runner([bars[index] for index in test], rule)["metrics"] for _, test in windows]
            candidates.append({
                "volume_multiplier": volume_multiplier,
                "quality_threshold": quality_threshold,
                "train_expectancy": mean(float(metric["expectancy"]) for metric in train_metrics),
                "out_of_sample_expectancy": mean(float(metric["expectancy"]) for metric in test_metrics),
                "out_of_sample_total_return": mean(float(metric["total_return"]) for metric in test_metrics),
                "out_of_sample_trade_count": sum(float(metric["trade_count"]) for metric in test_metrics),
            })
    best = max(candidates, key=lambda item: (item["out_of_sample_expectancy"], item["out_of_sample_total_return"], item["out_of_sample_trade_count"]))
    return {"pattern_type": pattern_type, "best": best, "candidates": candidates}


def calibrate_patterns(bars: Sequence[dict], pattern_types: Sequence[str]) -> list[dict]:
    return [calibrate_pattern(bars, pattern_type) for pattern_type in pattern_types]
