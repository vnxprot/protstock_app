from __future__ import annotations


def invalidation_width_warning(entry: float, invalidation_price: float, atr: float | None, atr_multiple: float = 2.0) -> str | None:
    if atr is None or atr <= 0:
        return None
    return "INVALIDATION_TOO_WIDE" if entry - invalidation_price > atr * atr_multiple * 1.5 else None


def position_size(capital: float, max_risk_pct: float, entry: float, stop: float, atr: float | None = None, atr_multiple: float = 2.0) -> dict:
    if min(capital, max_risk_pct, entry) <= 0:
        raise ValueError("capital, max_risk_pct and entry must be positive")
    effective_stop = stop
    if atr is not None and atr > 0:
        effective_stop = max(stop, entry - atr * atr_multiple)
    risk_per_share = entry - effective_stop
    if risk_per_share <= 0:
        raise ValueError("stop must be below entry")
    risk_budget = capital * max_risk_pct / 100
    quantity = int(risk_budget / risk_per_share)
    return {"quantity": quantity, "risk_budget": risk_budget, "risk_per_share": risk_per_share, "effective_stop": effective_stop, "position_value": quantity * entry, "invalidation_warning": invalidation_width_warning(entry, stop, atr, atr_multiple)}


def portfolio_exposure(positions: list[dict], capital: float) -> dict:
    total = sum(float(item["market_price"]) * int(item["quantity"]) for item in positions)
    sectors: dict[str, float] = {}
    for item in positions:
        sectors[item["sector"]] = sectors.get(item["sector"], 0) + float(item["market_price"]) * int(item["quantity"])
    return {"total_value": total, "exposure_pct": total / capital * 100 if capital else 0, "sector_weights": {key: value / total * 100 for key, value in sectors.items()} if total else {}}
