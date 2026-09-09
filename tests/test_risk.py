import pytest

from protstock.risk import portfolio_exposure, position_size


def test_atr_position_sizing_respects_risk_budget() -> None:
    result = position_size(1_000_000_000, 1, 50_000, 45_000, atr=1_500, atr_multiple=2)
    assert result["effective_stop"] == 47_000
    assert result["quantity"] * result["risk_per_share"] <= result["risk_budget"]


def test_portfolio_exposure_groups_sector() -> None:
    result = portfolio_exposure([{"market_price": 10, "quantity": 100, "sector": "BANK"}, {"market_price": 20, "quantity": 100, "sector": "BANK"}], 10_000)
    assert result["total_value"] == 3000
    assert result["sector_weights"]["BANK"] == 100


def test_position_sizing_rejects_invalid_stop() -> None:
    with pytest.raises(ValueError):
        position_size(100_000_000, 1, 20_000, 21_000)
