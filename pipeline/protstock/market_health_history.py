from __future__ import annotations

from collections import defaultdict, deque
from datetime import date
from typing import Sequence

from .flow import calculate_flow
from .market_regime import MIN_BREADTH_COVERAGE_RATIO, compute_breadth


def _index_trends(index_rows: Sequence[dict]) -> dict[str, str]:
    """Calculate the same SMA20/SMA50 regime as daily indicators, as of each day."""
    closes: deque[float] = deque(maxlen=50)
    result = {}
    for row in sorted(index_rows, key=lambda item: item["trading_date"]):
        close = float(row["close"])
        closes.append(close)
        trend = "UNKNOWN"
        if len(closes) == 50:
            values = list(closes)
            sma20, sma50 = sum(values[-20:]) / 20, sum(values) / 50
            trend = "UP" if close > sma20 > sma50 else "DOWN" if close < sma20 < sma50 else "SIDEWAYS"
        result[row["trading_date"]] = trend
    return result


def build_market_health_history(active_symbols: Sequence[dict], price_rows: Sequence[dict], start_date: date, end_date: date, *, index_rows: Sequence[dict] = ()) -> list[dict]:
    """Build point-in-time breadth from stored daily OHLCV; no external data calls."""
    sector_by_symbol = {row["id"]: row.get("sector") for row in active_symbols}
    index_trends = _index_trends(index_rows)
    by_symbol: dict[int, list[dict]] = defaultdict(list)
    for row in price_rows:
        if row.get("symbol_id") in sector_by_symbol:
            by_symbol[row["symbol_id"]].append(row)
    by_day: dict[str, list[dict]] = defaultdict(list)
    prior_valid_dates: dict[int, date] = {}
    for symbol_id, rows in by_symbol.items():
        closes: deque[float] = deque(maxlen=200)
        flow_bars: deque[dict] = deque(maxlen=21)
        prior_close: float | None = None
        for row in sorted(rows, key=lambda item: item["trading_date"]):
            close = float(row["close"])
            closes.append(close)
            if row.get("high") is not None and row.get("low") is not None:
                flow_bars.append(row)
            if row["trading_date"] < start_date.isoformat() or row["trading_date"] > end_date.isoformat():
                if row["trading_date"] < start_date.isoformat() and len(closes) >= 50:
                    prior_valid_dates[symbol_id] = date.fromisoformat(row["trading_date"])
                prior_close = close
                continue
            values = list(closes)
            def sma(length: int): return sum(values[-length:]) / length if len(values) >= length else None
            sma20, sma50, sma200 = sma(20), sma(50), sma(200)
            flow = calculate_flow(list(flow_bars)) if len(flow_bars) >= 20 else {}
            by_day[row["trading_date"]].append({
                "symbol_id": symbol_id, "close": close, "sma20": sma20, "sma50": sma50, "sma200": sma200,
                "ma_stack": bool(sma20 is not None and sma50 is not None and sma200 is not None and sma20 > sma50 > sma200),
                "last_volume": float(row.get("volume") or 0),
                "close_high20": max(values[-20:]) if len(values) >= 20 else None,
                "close_low20": min(values[-20:]) if len(values) >= 20 else None,
                "prior_close": prior_close,
                "flow_score": flow.get("flow_score"), "flow_state": flow.get("flow_state"),
            })
            prior_close = close
    output = []
    for trading_date, snapshots in sorted(by_day.items()):
        current_day = date.fromisoformat(trading_date)
        observed_ids = {item["symbol_id"] for item in snapshots if item["sma50"] is not None}
        eligible_ids = observed_ids | {symbol_id for symbol_id, last_day in prior_valid_dates.items() if 0 <= (current_day - last_day).days <= 7}
        prior = {item["symbol_id"]: {"close": item["prior_close"]} for item in snapshots if item["prior_close"] is not None}
        breadth = compute_breadth(snapshots, prior, sector_by_symbol)
        observed, eligible = breadth["sample_size"], len(eligible_ids)
        ratio = observed / eligible if eligible else None
        coverage = "BOOTSTRAP" if not eligible else "COMPLETE" if observed == eligible else "DEGRADED" if ratio is not None and ratio >= MIN_BREADTH_COVERAGE_RATIO else "INCOMPLETE"
        output.append({"trading_date": trading_date, **breadth, "universe_size": len(active_symbols), "eligible_count": eligible, "observed_count": observed, "coverage_ratio": ratio, "coverage_status": coverage, "vnindex_trend_state": index_trends.get(trading_date, "UNKNOWN")})
        prior_valid_dates.update({symbol_id: current_day for symbol_id in observed_ids})
    return output
