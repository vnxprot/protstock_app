from pathlib import Path

from protstock.universe import load_universe


def test_locked_universe() -> None:
    result = load_universe(Path("data/universe.csv"))
    assert result.is_valid
    assert len(result.rows) == 205
    assert len({row.symbol for row in result.rows}) == 205
    assert all(row.active for row in result.rows)
    assert [(row.symbol, row.sector) for row in result.rows if row.symbol == "TDC"] == [
        ("TDC", "BDS_KCN")
    ]
    assert result.sha256 == "bedc98def9f6cd86cd7f585b47114c86f35b220a132a7fcf0d28d9c160f17d3e"
