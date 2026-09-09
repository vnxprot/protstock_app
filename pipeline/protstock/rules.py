from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Sequence


@dataclass(frozen=True)
class CompiledRule:
    action: str
    timeframe: str
    conditions: tuple[dict[str, Any], ...]

    def to_dict(self) -> dict[str, Any]:
        return {"version": 1, "action": self.action, "timeframe": self.timeframe, "all": list(self.conditions)}


def compile_rule(text: str) -> CompiledRule:
    normalized = " ".join(text.lower().replace(",", ".").split())
    action = "SELL" if any(word in normalized for word in ("bán", "thoát", "stop-loss", "cắt lỗ")) else "BUY"
    timeframe = "W" if "tuần" in normalized else "M" if "tháng" in normalized else "D"
    conditions: list[dict[str, Any]] = []

    breakout = re.search(r"(?:vượt đỉnh|breakout)\s+(\d+)\s*(?:phiên)?", normalized)
    if breakout:
        conditions.append({"metric": "close", "op": "breakout_high", "lookback": int(breakout.group(1))})
    volume = re.search(r"(?:volume|khối lượng)\s+(?:lớn hơn|>)\s+(\d+(?:\.\d+)?)\s*lần", normalized)
    if volume:
        conditions.append({"metric": "volume_ratio20", "op": ">", "value": float(volume.group(1))})
    if re.search(r"ma\s*20\s*>\s*ma\s*50\s*>\s*ma\s*200", normalized):
        conditions.append({"metric": "ma_stack", "op": "bullish"})
    rsi = re.search(r"rsi(?:\s*14)?\s*(?:từ|trong khoảng)\s*(\d+(?:\.\d+)?)\s*(?:đến|-)\s*(\d+(?:\.\d+)?)", normalized)
    if rsi:
        conditions.append({"metric": "rsi14", "op": "between", "min": float(rsi.group(1)), "max": float(rsi.group(2))})
    stop = re.search(r"(?:stop-loss|cắt lỗ)\s*(\d+(?:\.\d+)?)\s*%", normalized)
    if stop:
        conditions.append({"metric": "return_from_entry", "op": "<=", "value": -float(stop.group(1)) / 100})
    if not conditions:
        raise ValueError("Không nhận ra điều kiện. Hãy dùng breakout, volume, MA, RSI hoặc stop-loss.")
    return CompiledRule(action, timeframe, tuple(conditions))


def evaluate_rule(rule: dict[str, Any], snapshot: dict[str, Any], bars: Sequence[dict]) -> tuple[bool, list[str]]:
    results: list[tuple[bool, str]] = []
    for condition in rule.get("all", []):
        metric, op = condition["metric"], condition["op"]
        if op == "breakout_high":
            lookback = int(condition["lookback"])
            prior = [float(item["high"]) for item in bars[-lookback - 1:-1]]
            passed = bool(prior) and float(bars[-1]["close"]) > max(prior)
        elif metric == "ma_stack":
            values = (snapshot.get("sma20"), snapshot.get("sma50"), snapshot.get("sma200"))
            passed = all(value is not None for value in values) and values[0] > values[1] > values[2]
        elif op == "between":
            value = snapshot.get(metric)
            passed = value is not None and condition["min"] <= float(value) <= condition["max"]
        else:
            value = snapshot.get(metric)
            target = float(condition["value"])
            passed = value is not None and ((op == ">" and float(value) > target) or (op == "<=" and float(value) <= target))
        results.append((passed, f"{metric}:{'PASS' if passed else 'FAIL'}"))
    return all(item[0] for item in results), [item[1] for item in results]

