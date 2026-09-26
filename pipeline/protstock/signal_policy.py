"""Common post-proposal policy. Stock prices are thousand VND; capital is VND."""
from math import isfinite

from .market_regime import regime_ok
from .risk import portfolio_exposure, position_size

STOCK_PRICE_TO_VND = 1000.0
MIN_AVERAGE_TURNOVER_VND = 300_000_000


def average_turnover_vnd(snapshot: dict) -> float:
    return float(snapshot.get("close") or 0) * float(snapshot.get("volume_avg20") or 0) * STOCK_PRICE_TO_VND


def apply_signal_policy(action: str, reasons: list[str], context: dict) -> tuple[str, list[str]]:
    """No indicator-specific confirmation here: enforce safety for EVERY source."""
    reasons = list(reasons)
    snapshot = context.get("snapshot") or {}
    position = context.get("position")
    close = float(snapshot.get("close") or 0)
    stop = (position or {}).get("invalidation_price")
    if context.get("data_date") != context.get("evaluation_date"):
        # Stale data is an audit failure, not an entry setup.  The caller
        # suppresses emission while retaining this reason in evaluations.
        blocked = ["ENTRY_BLOCKED"] if action in {"PROBE_BUY", "ADD"} else []
        return "WATCH", list(dict.fromkeys([*reasons, *blocked, "STALE_PRICE_DATA"]))
    if position and stop and close > 0 and close < float(stop):
        return "EXIT", ["INVALIDATION_BROKEN", *reasons]
    if action in {"REDUCE", "EXIT"}:
        return (action, reasons) if position else ("WATCH", [*reasons, "NO_OPEN_POSITION"])
    if action not in {"PROBE_BUY", "ADD"}:
        return action, reasons
    blocked = []
    if not isfinite(close) or close <= 0:
        blocked.append("INVALID_PRICE")
    # Liquidity is ALWAYS daily turnover, even for weekly/monthly setups.
    turnover = average_turnover_vnd(context.get("daily_snapshot") or snapshot)
    if not isfinite(turnover) or turnover < MIN_AVERAGE_TURNOVER_VND:
        blocked.append("INSUFFICIENT_LIQUIDITY")
    market = context.get("market_context")
    if not market:
        blocked.append("MARKET_CONTEXT_MISSING")
    else:
        ok, codes = regime_ok(market.get("breadth"), market.get("vnindex_snapshot"))
        if not ok:
            blocked.extend(codes)
        else:
            # Degraded coverage remains transparent, but must not become a
            # mechanical veto when the eligible sample is still representative.
            reasons.extend(codes)
        if (market.get("vnindex_snapshot") or {}).get("trend_state") in {None, "UNKNOWN"}:
            blocked.append("VNINDEX_CONTEXT_UNAVAILABLE")
    wyckoff = context.get("wyckoff_context") or {}
    if wyckoff.get("state") == "DISTRIBUTION":
        blocked.append("WYCKOFF_DISTRIBUTION_CONTEXT")
    elif wyckoff.get("state") == "ACCUMULATION":
        reasons.extend(wyckoff.get("reasons") or [])
    mtf = context.get("multi_timeframe_context") or {}
    monthly = (mtf.get("monthly_snapshot") or {}).get("trend_state")
    if monthly in {None, "UNKNOWN", "DOWN"}:
        blocked.append("MONTHLY_CONTEXT_UNAVAILABLE" if monthly != "DOWN" else "MONTHLY_DOWNTREND")
    if action == "ADD" and not position:
        blocked.append("NO_OPEN_POSITION")
    capital = float(context.get("capital") or 0)
    positions = context.get("portfolio_positions")
    evidence = context.get("engine_evidence") or {}
    entry_stop = evidence.get("invalidation_price")
    if not entry_stop and snapshot.get("atr14"):
        entry_stop = close - 2 * float(snapshot["atr14"])
        evidence["invalidation_price"] = entry_stop
        evidence["stop_basis"] = "ATR_2"
    if not entry_stop or not 0 < float(entry_stop) < close:
        blocked.append("INVALID_ENTRY_STOP")
    if context.get("portfolio_error"):
        blocked.append("PORTFOLIO_CONTEXT_UNAVAILABLE")
    if capital > 0 and positions is not None and entry_stop and 0 < float(entry_stop) < close:
        sizing = position_size(capital, float(context.get("risk_pct") or 1), close * STOCK_PRICE_TO_VND, float(entry_stop) * STOCK_PRICE_TO_VND)
        exposure = portfolio_exposure(positions, capital)
        available = max(0.0, capital - exposure["total_value"])
        quantity = min(sizing["quantity"], int(available / (close * STOCK_PRICE_TO_VND)))
        value = quantity * close * STOCK_PRICE_TO_VND
        sector = context.get("candidate_sector")
        existing = exposure["total_value"] * exposure["sector_weights"].get(sector, 0) / 100
        evidence["sizing"] = {"quantity": quantity, "value_vnd": value, "projected_sector_weight_pct": (existing + value) / capital * 100}
        if not quantity:
            blocked.append("NO_BUYING_POWER")
        if (existing + value) / capital * 100 > float(context.get("max_sector_weight_pct", 30)):
            blocked.append("SECTOR_CONCENTRATION_LIMIT")
    elif capital <= 0:
        reasons.append("SIZING_UNAVAILABLE_NO_PORTFOLIO")
    context["engine_evidence"] = evidence
    if blocked:
        return "WATCH", list(dict.fromkeys([*reasons, "ENTRY_BLOCKED", *blocked]))
    return ("ADD" if position else "PROBE_BUY"), reasons
