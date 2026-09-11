from pathlib import Path

from protstock.universe import load_universe


def test_locked_universe() -> None:
    result = load_universe(Path("data/universe.csv"))
    assert result.is_valid
    assert len(result.rows) == 204
    assert len({row.symbol for row in result.rows}) == 204
    assert all(row.active for row in result.rows)
    assert [(row.symbol, row.sector) for row in result.rows if row.symbol == "TDC"] == [
        ("TDC", "BDS_KCN")
    ]
    # Regenerate after an approved universe revision with: sha256sum data/universe.csv
    assert result.sha256 == "8c6837d331b25549a5aebe65005ed81692160a3f2a23818684ec213c6c00f8a5"
