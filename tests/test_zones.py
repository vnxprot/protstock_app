from datetime import date, timedelta

from protstock.zones import detect_zones


def test_repeated_pivots_form_explainable_zones() -> None:
    closes = [10, 11, 12, 11, 10, 11, 12.1, 11, 10.1, 11, 12.05, 11, 11.5]
    bars = [{"date": (date(2025, 1, 1) + timedelta(days=i)).isoformat(), "open": c, "high": c + .1, "low": c - .1, "close": c, "volume": 1_000_000} for i, c in enumerate(closes)]
    zones = detect_zones(bars, window=1)
    assert {zone["zone_type"] for zone in zones} == {"SUPPORT", "RESISTANCE"}
    assert all(zone["touches"] >= 2 for zone in zones)
