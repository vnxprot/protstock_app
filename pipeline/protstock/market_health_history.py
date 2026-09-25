from __future__ import annotations

from collections import defaultdict, deque
from datetime import date
from typing import Sequence

from .market_regime import compute_breadth


def build_market_health_history(active_symbols: Sequence[dict], price_rows: Sequence[dict], start_date: date, end_date: date) -> list[dict]:
    """Build point-in-time breadth from stored daily OHLCV; no external data calls."""
    sector_by_symbol = {row["id"]: row.get("sector") for row in active_symbols}
    by_symbol: dict[int, list[dict]] = defaultdict(list)
    for row in price_rows:
        if row.get("symbol_id") in sector_by_symbol:
            by_symbol[row["symbol_id"]].append(row)
    by_day: dict[str, list[dict]] = defaultdict(list)
    for symbol_id, rows in by_symbol.items():
        closes: deque[float] = deque(maxlen=200)
        prior_close: float | None = None
        for row in sorted(rows, key=lambda item: item["trading_date"]):
            close = float(row["close"])
            closes.append(close)
            if row["trading_date"] < start_date.isoformat() or row["trading_date"] > end_date.isoformat():
                prior_close = close
                continue
            values = list(closes)
            def sma(length: int): return sum(values[-length:]) / length if len(values) >= length else None
            sma20, sma50, sma200 = sma(20), sma(50), sma(200)
            by_day[row["trading_date"]].append({
                "symbol_id": symbol_id, "close": close, "sma20": sma20, "sma50": sma50, "sma200": sma200,
                "ma_stack": bool(sma20 is not None and sma50 is not None and sma200 is not None and sma20 > sma50 > sma200),
                "last_volume": float(row.get("volume") or 0),
                "close_high20": max(values[-20:]) if len(values) >= 20 else None,
                "close_low20": min(values[-20:]) if len(values) >= 20 else None,
                "prior_close": prior_close,
            })
            prior_close = close
    output = []
    for trading_date, snapshots in sorted(by_day.items()):
        prior = {item["symbol_id"]: {"close": item["prior_close"]} for item in snapshots if item["prior_close"] is not None}
        breadth = compute_breadth(snapshots, prior, sector_by_symbol)
        observed = breadth["sample_size"]
        output.append({"trading_date": trading_date, **breadth, "universe_size": len(active_symbols), "eligible_count": observed, "observed_count": observed, "coverage_ratio": 1.0 if observed else None, "coverage_status": "COMPLETE" if observed else "BOOTSTRAP", "vnindex_trend_state": "UNKNOWN"})
    return output
