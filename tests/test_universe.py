from pathlib import Path

from protstock.universe import load_universe


def test_locked_universe() -> None:
    result = load_universe(Path("data/universe.csv"))
    assert result.is_valid
    assert len(result.rows) == 202
    assert len({row.symbol for row in result.rows}) == 202
    assert all(row.active for row in result.rows)
    assert [(row.symbol, row.sector) for row in result.rows if row.symbol == "TDC"] == [
        ("TDC", "BDS_KCN")
    ]
    # Regenerate after an approved universe revision with: sha256sum data/universe.csv
    assert result.sha256 == "e38b31c6af6947d2c0761e8f26a2d48cc8272dbcd98ccc3c7a952366b372d4a7"
