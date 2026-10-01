"""Synchronize a coherent KBS historical research series without rewriting raw bars."""

from __future__ import annotations

from datetime import date
from time import sleep

from .config import Settings
from .provider_vnstock import KBS_SOURCE_VERSION, STOCK_PRICE_UNIT, VnstockProvider
from .supabase_rest import SupabaseRestClient


# VSDC notice 199296: one existing TRC share received three bonus shares;
# the ex-rights session was 2026-09-15.  KBS rebases earlier prices but
# reports earlier share volume without the reciprocal 4x share adjustment.
TRC_BONUS_EX_DATE = date(2026, 9, 15)
TRC_BONUS_SOURCE_URL = "https://vsdc.vn/vi/ad/199296"


def research_price_rows(symbol_id: int, symbol: str, bars: list) -> list[dict]:
    """Keep all vendor bars but quarantine unexplained scale discontinuities."""
    ordered = sorted(bars, key=lambda item: item.trading_date)
    result = []
    for index, bar in enumerate(ordered):
        left = float(ordered[index - 1].close) if index else None
        right = float(bar.close)
        invalid = bool(left and (right / left <= 0.5 or right / left >= 2))
        if index + 1 < len(ordered):
            following = float(ordered[index + 1].close)
            invalid = invalid or following / right <= 0.5 or following / right >= 2
        rebase_volume = symbol == "TRC" and bar.trading_date < TRC_BONUS_EX_DATE
        result.append({
            "symbol_id": symbol_id, "trading_date": bar.trading_date.isoformat(),
            "open": float(bar.open), "high": float(bar.high), "low": float(bar.low),
            "close": right, "volume": bar.volume * (4 if rebase_volume else 1),
            "volume_basis": "VSDC_BONUS_REBASED" if rebase_volume else "VENDOR_REPORTED",
            "volume_adjustment_factor": 4 if rebase_volume else 1,
            "price_unit": STOCK_PRICE_UNIT,
            "basis": "KBS_VENDOR_REBASED", "source": "KBS_PUBLIC",
            "source_version": KBS_SOURCE_VERSION,
            "source_url": f"{VnstockProvider.API_BASE}/stocks/{symbol}/data_day",
            "collected_at": bar.collected_at.isoformat(),
            "quality_status": "QUARANTINED" if invalid else "VALID",
        })
    return result


def sync_research_prices(start_date: date, end_date: date, *, symbol_offset: int = 0,
                         symbol_limit: int | None = None, pause_seconds: float = 3.0,
                         symbols: set[str] | None = None, apply: bool = False) -> dict:
    if start_date > end_date:
        raise ValueError("start_date must be on or before end_date")
    client = SupabaseRestClient(Settings.from_env())
    provider = VnstockProvider("KBS")
    totals = {"symbols": 0, "bars": 0, "quarantined": 0, "missing": 0,
              "matched": 0, "incomplete": 0, "unmatched_stored_dates": 0,
              "failed": [], "mode": "apply" if apply else "dry-run"}
    try:
        candidates = client.all_symbols_for_replay()
        if symbols:
            candidates = [item for item in candidates if item["symbol"] in symbols]
        else:
            candidates = candidates[symbol_offset:]
            if symbol_limit is not None:
                candidates = candidates[:symbol_limit]
        for index, item in enumerate(candidates):
            try:
                bars = provider.history(item["symbol"], start_date, end_date)
                rows = research_price_rows(item["id"], item["symbol"], bars)
                if not rows:
                    totals["missing"] += 1
                    continue
                stored = [row for row in client.price_history(item["id"], 2600)
                          if start_date.isoformat() <= row["trading_date"] <= end_date.isoformat()]
                stored_dates = {row["trading_date"] for row in stored}
                vendor_dates = {row["trading_date"] for row in rows}
                unmatched = len(stored_dates - vendor_dates)
                quarantined = sum(row["quality_status"] == "QUARANTINED" for row in rows)
                coverage_status = ("QUARANTINED" if quarantined else
                                   "INCOMPLETE" if unmatched else "MATCHED")
                if apply:
                    for offset in range(0, len(rows), 100):
                        client.upsert("research_price_bars", rows[offset:offset + 100],
                                      "symbol_id,trading_date")
                    client.upsert("research_price_sync_status", [{
                        "symbol_id": item["id"],
                        "requested_start_date": start_date.isoformat(),
                        "requested_end_date": end_date.isoformat(),
                        "first_date": rows[0]["trading_date"],
                        "last_date": rows[-1]["trading_date"], "vendor_bars": len(rows),
                        "stored_bars": len(stored), "unmatched_stored_dates": unmatched,
                        "quarantined_bars": quarantined, "coverage_status": coverage_status,
                        "source_version": KBS_SOURCE_VERSION,
                    }], "symbol_id")
                totals["symbols"] += 1
                totals["bars"] += len(rows)
                totals["quarantined"] += quarantined
                totals["unmatched_stored_dates"] += unmatched
                totals["matched" if coverage_status == "MATCHED" else "incomplete"] += 1
            except Exception as exc:
                totals["failed"].append({"symbol": item["symbol"], "error": str(exc)[:180]})
            if index + 1 < len(candidates) and pause_seconds:
                sleep(pause_seconds)
        return totals
    finally:
        client.close()
