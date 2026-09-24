from pathlib import Path

from protstock.universe import load_universe


def test_locked_universe() -> None:
    result = load_universe(Path("data/universe.csv"))
    assert result.is_valid
    assert len(result.rows) == 208
    assert len({row.symbol for row in result.rows}) == 208
    assert all(row.active for row in result.rows)
    assert {row.symbol for row in result.rows} >= {"APH", "HII", "MZG", "TDP", "VNB", "VTZ"}
    assert [(row.symbol, row.sector) for row in result.rows if row.symbol == "TDC"] == [
        ("TDC", "BDS_KCN")
    ]
    # Regenerate after an approved universe revision with: sha256sum data/universe.csv
    assert result.sha256 == "d037904c802128dfa9c9df7a73e9e6267407f61a296d4760a5bb409ba5c04688"
