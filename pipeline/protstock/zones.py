from __future__ import annotations

from typing import Sequence
from .fibonacci import FIB_BONUS_CAP, matching_fibonacci


def zone_confluence_bonus(trigger_price: float, direction: str, zones: Sequence[dict], tolerance_pct: float = 0.02) -> tuple[float, str | None]:
    kind = "RESISTANCE" if direction == "BULLISH" else "SUPPORT"
    matches = [zone for zone in zones if zone.get("zone_type") == kind and float(zone["lower_price"]) * (1 - tolerance_pct) <= trigger_price <= float(zone["upper_price"]) * (1 + tolerance_pct)]
    if not matches:
        return 0.0, None
    best = max(matches, key=lambda zone: float(zone["strength"]))
    return min(8.0, float(best["strength"]) * 0.08), "ZONE_CONFLUENCE"


def detect_zones(bars: Sequence[dict], window: int = 2, tolerance: float = 0.018, *, fibonacci_context: dict | None = None) -> list[dict]:
    if len(bars) < window * 2 + 3:
        return []
    scoped = list(bars[-160:])
    pivots: list[tuple[str, int, float]] = []
    for index in range(window, len(scoped) - window):
        neighbors = scoped[index - window:index + window + 1]
        high, low = float(scoped[index]["high"]), float(scoped[index]["low"])
        if high == max(float(item["high"]) for item in neighbors):
            pivots.append(("RESISTANCE", index, high))
        if low == min(float(item["low"]) for item in neighbors):
            pivots.append(("SUPPORT", index, low))
    current = float(scoped[-1]["close"])
    zones: list[dict] = []
    for kind in ("SUPPORT", "RESISTANCE"):
        candidates = [item for item in pivots if item[0] == kind and ((kind == "SUPPORT" and item[2] <= current) or (kind == "RESISTANCE" and item[2] >= current))]
        clusters: list[list[tuple[str, int, float]]] = []
        for pivot in candidates:
            target = next((cluster for cluster in clusters if abs(pivot[2] / (sum(item[2] for item in cluster) / len(cluster)) - 1) <= tolerance), None)
            if target is None:
                clusters.append([pivot])
            else:
                target.append(pivot)
        for cluster in clusters:
            if len(cluster) < 2:
                continue
            prices = [item[2] for item in cluster]
            center = sum(prices) / len(prices)
            volume_ratios, reactions = [], []
            offset = len(bars) - len(scoped)
            for _, index, _ in cluster:
                bar = scoped[index]
                previous = bars[max(0, offset + index - 20):offset + index]
                baseline = sum(float(b.get("volume") or 0) for b in previous) / len(previous) if previous else 0
                if baseline > 0:
                    volume_ratios.append(float(bar.get("volume") or 0) / baseline)
                spread = float(bar["high"]) - float(bar["low"])
                if spread > 0:
                    rejection = float(bar["close"]) - float(bar["low"]) if kind == "SUPPORT" else float(bar["high"]) - float(bar["close"])
                    reactions.append(max(0, min(1, rejection / spread)))
            last_index = max(item[1] for item in cluster)
            age = len(scoped) - 1 - last_index
            ratio = sum(volume_ratios) / len(volume_ratios) if volume_ratios else None
            reaction = sum(reactions) / len(reactions) if reactions else None
            components = {"touches": min(60, 20 + len(cluster) * 10), "volume": min(15, (ratio or 0) * 7.5), "reaction": (reaction or 0) * 15, "recency": max(0, 1 - age / 160) * 10}
            zone = {
                "zone_type": kind, "start_index": offset + min(item[1] for item in cluster),
                "lower_price": min(prices) * 0.997, "upper_price": max(prices) * 1.003,
                "touches": len(cluster), "strength": min(100, sum(components.values())),
                "evidence": {"pivot_prices": prices, "center": center, "tolerance": tolerance, "quality_version": "pivot-volume-reaction-v1", "components": components, "volume_ratio_at_touches": ratio, "reaction_pct": None if reaction is None else reaction * 100, "age_bars": age, "last_touch_date": scoped[last_index]["date"]},
            }
            matches = matching_fibonacci(center, fibonacci_context or {}, [zone]) if kind == "SUPPORT" else []
            if matches:
                zone["strength"] = min(100, zone["strength"] + FIB_BONUS_CAP)
                zone["evidence"].update(fibonacci=matches, fib_bonus=FIB_BONUS_CAP, reasons=["FIB_CONFLUENCE"])
            zones.append(zone)
    return sorted(zones, key=lambda item: item["strength"], reverse=True)[:6]
