from __future__ import annotations

from typing import Sequence


def detect_zones(bars: Sequence[dict], window: int = 2, tolerance: float = 0.018) -> list[dict]:
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
            zones.append({
                "zone_type": kind, "start_index": min(item[1] for item in cluster),
                "lower_price": min(prices) * 0.997, "upper_price": max(prices) * 1.003,
                "touches": len(cluster), "strength": min(100, 25 + len(cluster) * 15),
                "evidence": {"pivot_prices": prices, "center": center, "tolerance": tolerance},
            })
    return sorted(zones, key=lambda item: item["strength"], reverse=True)[:6]
