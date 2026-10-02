from __future__ import annotations

import re
from dataclasses import dataclass, field
from math import isfinite
from typing import Any, Sequence


@dataclass(frozen=True)
class CompiledRule:
    action: str
    timeframe: str
    conditions: tuple[dict[str, Any], ...]
    risk: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"version": 2, "action": self.action, "timeframe": self.timeframe,
                "all": list(self.conditions), **({"risk": self.risk} if self.risk else {})}


def compile_rule(text: str) -> CompiledRule:
    """Small grammar, mirrored in src/lib/ruleDsl.ts; unknown clauses fail closed."""
    normalized = " ".join(re.sub(r"(\d),(\d)", r"\1.\2", text.lower()).split())
    residue = normalized
    action_words = re.findall(r"\b(?:theo dõi|bán hết|thoát|giảm tỷ trọng|bán|mua)\b", normalized)
    explicit_actions = {"WATCH" if word == "theo dõi" else "EXIT" if word in {"thoát", "bán hết"}
                        else "REDUCE" if word in {"bán", "giảm tỷ trọng"} else "PROBE_BUY" for word in action_words}
    if len(explicit_actions) > 1:
        raise ValueError("Chỉ mô tả một hành động trong mỗi quy tắc.")
    action = next(iter(explicit_actions), "PROBE_BUY")
    timeframe = "W" if "tuần" in normalized else "M" if "tháng" in normalized else "D"
    conditions: list[dict[str, Any]] = []
    risk: dict[str, float] = {}

    def take(expression: str):
        nonlocal residue
        matches = list(re.finditer(expression, normalized))
        if len(matches) > 1:
            raise ValueError("Mỗi loại điều kiện chỉ được khai báo một lần.")
        if matches:
            residue = re.sub(expression, " ", residue)
            return matches[0]
        return None

    breakout = take(r"(?:vượt đỉnh|breakout)(?:\s+đỉnh)?\s+(\d+)\s*(?:phiên)?")
    if breakout:
        lookback = int(breakout.group(1))
        if not 1 <= lookback <= 500:
            raise ValueError("Số phiên breakout phải nằm trong 1–500.")
        conditions.append({"metric": "close", "op": "breakout_high", "lookback": lookback})
    volume = take(r"(?:volume|khối lượng)\s+(?:lớn hơn|>)\s+(\d+(?:\.\d+)?)\s*lần")
    if volume:
        value = float(volume.group(1))
        if not 0 < value <= 100:
            raise ValueError("Hệ số khối lượng phải lớn hơn 0 và không quá 100.")
        conditions.append({"metric": "volume_ratio20", "op": ">", "value": value})
    if take(r"ma\s*20\s*>\s*ma\s*50\s*>\s*ma\s*200"):
        conditions.append({"metric": "ma_stack", "op": "bullish"})
    rsi = take(r"rsi(?:\s*14)?\s*(?:từ|trong khoảng)\s*(\d+(?:\.\d+)?)\s*(?:đến|-)\s*(\d+(?:\.\d+)?)")
    if rsi:
        low, high = float(rsi.group(1)), float(rsi.group(2))
        if not 0 <= low <= high <= 100:
            raise ValueError("Khoảng RSI phải tăng dần trong 0–100.")
        conditions.append({"metric": "rsi14", "op": "between", "min": low, "max": high})
    names = {"nền tích lũy": "ACCUMULATION_BASE", "double bottom": "DOUBLE_BOTTOM", "hai đáy": "DOUBLE_BOTTOM",
             "double top": "DOUBLE_TOP", "hai đỉnh": "DOUBLE_TOP", "tam giác tăng": "ASCENDING_TRIANGLE", "cờ tăng": "BULL_FLAG"}
    pattern = take(r"(nền tích lũy|double bottom|hai đáy|double top|hai đỉnh|tam giác tăng|cờ tăng)(?:\s+(?:đã\s+)?(xác nhận|sẵn sàng))?")
    if pattern:
        conditions.append({"metric": "pattern", "op": "ready" if pattern.group(2) == "sẵn sàng" else "confirmed", "type": names[pattern.group(1)]})
    stop = take(r"(?:stop-loss|cắt lỗ)\s*(\d+(?:\.\d+)?)\s*%(?:\s+từ giá vốn)?")
    if stop:
        value = float(stop.group(1)) / 100
        if not 0 < value < 1:
            raise ValueError("Cắt lỗ phải lớn hơn 0% và nhỏ hơn 100%.")
        if conditions and action == "PROBE_BUY":
            risk["stop_loss_pct"] = value
        elif not conditions:
            if "PROBE_BUY" in explicit_actions:
                raise ValueError("Cắt lỗ là điều kiện thoát; thêm điều kiện mua trước khi đặt mức cắt lỗ.")
            action = "EXIT"
            conditions.append({"metric": "return_from_entry", "op": "<=", "value": -value})
        else:
            raise ValueError("Tách quy tắc bán/theo dõi và cắt lỗ thành hai quy tắc rõ ràng.")
    residue = re.sub(r"\b(?:theo dõi|giá đóng cửa|mẫu hình|khung ngày|khung tuần|khung tháng|bán hết|giảm tỷ trọng|mua|bán|thoát|khi|và|ngày|tuần|tháng)\b", " ", residue)
    residue = re.sub(r"[\s,;.]+", " ", residue).strip()
    if residue:
        raise ValueError(f"Chưa hiểu phần: {residue}. Hãy dùng các điều kiện được hỗ trợ.")
    if not conditions:
        raise ValueError("Không nhận ra điều kiện. Hãy dùng breakout, volume, MA, RSI, mẫu hình hoặc stop-loss.")
    return CompiledRule(action, timeframe, tuple(conditions), risk)


def evaluate_rule(rule: dict[str, Any], snapshot: dict[str, Any], bars: Sequence[dict], patterns: Sequence[dict] = (), context: dict[str, Any] | None = None) -> tuple[bool, list[str]]:
    conditions = rule.get("all")
    if not isinstance(conditions, list) or not conditions:
        return False, ["RULE_CONDITIONS_MISSING"]
    values = dict(snapshot)
    position = (context or {}).get("position") or {}
    cost = position.get("average_cost") or position.get("entry_price")
    if cost is not None and float(cost) > 0 and snapshot.get("close") is not None:
        values["return_from_entry"] = float(snapshot["close"]) / float(cost) - 1
    results: list[tuple[bool, str]] = []
    for condition in conditions:
        metric, op = condition.get("metric"), condition.get("op")
        passed = False
        if metric == "pattern" and op in {"ready", "confirmed"}:
            passed = any(p.get("pattern_type") == condition.get("type") and p.get("state") == op.upper() for p in patterns)
        elif metric == "close" and op == "breakout_high":
            lookback = int(condition.get("lookback") or 0)
            prior = [float(item["high"]) for item in bars[-lookback - 1:-1]] if lookback > 0 else []
            passed = len(prior) == lookback and lookback > 0 and float(bars[-1]["close"]) > max(prior)
        elif metric == "ma_stack" and op == "bullish":
            averages = (values.get("sma20"), values.get("sma50"), values.get("sma200"))
            passed = all(value is not None for value in averages) and averages[0] > averages[1] > averages[2]
        elif metric in {"close", "volume_ratio20", "rsi14", "return_from_entry"}:
            value = values.get(metric)
            if value is not None and isfinite(float(value)):
                if op == "between":
                    passed = float(condition["min"]) <= float(value) <= float(condition["max"])
                elif op in {">", "<=", ">=", "<"}:
                    target = float(condition["value"])
                    passed = isfinite(target) and {">": float(value) > target, "<=": float(value) <= target,
                                                   ">=": float(value) >= target, "<": float(value) < target}[op]
        results.append((passed, f"{metric}:{'PASS' if passed else 'FAIL'}"))
    return all(item[0] for item in results), [item[1] for item in results]


def multi_timeframe_gate(context: dict[str, Any]) -> tuple[bool, list[str]]:
    monthly = context.get("monthly_snapshot", {})
    weekly = context.get("weekly_patterns", [])
    weekly_confirmed = any(p.get("direction") == "BULLISH" and p.get("state") in {"READY", "CONFIRMED"} for p in weekly)
    monthly_ok = monthly.get("trend_state") in {"UP", "SIDEWAYS"}
    return monthly_ok and weekly_confirmed, [f"MONTHLY_{monthly.get('trend_state', 'UNKNOWN')}", "WEEKLY_BULLISH_SETUP" if weekly_confirmed else "WEEKLY_SETUP_MISSING"]
