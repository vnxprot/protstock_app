from protstock.repair_kbs_price_units import normalize_rows


def test_repairs_only_raw_kbs_stock_prices():
    rows = [
        {"source": "KBS_PUBLIC", "open": 27500, "high": 28000, "low": 27350, "close": 27800, "volume": 1000},
        {"source": "KBS_PUBLIC", "open": 900, "high": 900, "low": 900, "close": 900, "volume": 1000},
        {"source": "VNSTOCK_KBS", "open": 27.5, "high": 28, "low": 27.35, "close": 27.8, "volume": 1000},
    ]
    result = normalize_rows(rows)
    assert len(result) == 2
    assert result[0]["close"] == 27.8
    assert result[0]["source"] == "KBS_PUBLIC_REPAIRED"
    assert result[1]["close"] == .9
    assert result[0]["volume"] == 1000
    assert normalize_rows(result) == []
