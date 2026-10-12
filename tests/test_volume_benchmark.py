from protstock.indicators import calculate_indicators


def test_volume_ratio_excludes_evaluated_session() -> None:
    bars = [{"close": 100, "high": 101, "low": 99, "volume": 100} for _ in range(20)]
    assert calculate_indicators(bars).volume_avg20 is None
    bars.append({"close": 101, "high": 102, "low": 100, "volume": 200})
    snapshot = calculate_indicators(bars)
    assert snapshot.volume_avg20 == 100
    assert snapshot.volume_ratio20 == 2
