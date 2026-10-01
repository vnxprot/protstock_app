from pathlib import Path

from protstock.universe import PROT_SECTORS, load_universe


def test_locked_universe() -> None:
    result = load_universe(Path("data/universe.csv"))
    assert result.is_valid
    assert len(result.rows) == 265
    assert len({row.symbol for row in result.rows}) == 265
    assert all(row.active for row in result.rows)
    assert {row.symbol for row in result.rows}.isdisjoint({"DHM", "LTG", "DMC", "POS", "MTA", "AMC", "DHD"})
    assert [(row.symbol, row.sector, row.exchange) for row in result.rows if row.symbol == "TLG"] == [("TLG", "BAN LE", "HOSE")]
    assert {row.symbol for row in result.rows} >= {"APH", "HII", "MZG", "TDP", "VNB", "VTZ"}
    assert [(row.symbol, row.sector) for row in result.rows if row.symbol == "TDC"] == [
        ("TDC", "BDS_KCN")
    ]
    assert sum(row.trading_status == "NORMAL" for row in result.rows) == 261
    assert {row.symbol for row in result.rows if row.trading_status == "RESTRICTED"} == {"DGC", "PXS", "TAR", "TCD"}
    assert next(row for row in result.rows if row.symbol == "VPI").trading_status == "NORMAL"
    assert {row.sector for row in result.rows} == PROT_SECTORS


def test_new_universe_symbol_must_use_existing_prot_sector(tmp_path) -> None:
    path = tmp_path / "universe.csv"
    path.write_text("symbol,company_name,sector,exchange,trading_status,active\nAAA,Example,NEW_UNKNOWN_GROUP,HOSE,UNKNOWN,true\n", encoding="utf-8")
    validation = load_universe(path)
    assert not validation.is_valid
    assert "unknown_sector" in validation.invalid[0][1]
