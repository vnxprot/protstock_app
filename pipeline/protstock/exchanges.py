from __future__ import annotations

from .config import Settings
from .supabase_rest import SupabaseRestClient

MANUAL_EXCHANGE_OVERRIDES = {
    # LTG was removed from the live vendor directory after its UPCOM
    # deregistration; retain the last official board for the locked universe.
    "LTG": "UPCOM",
}

def sync_exchanges() -> dict[str, int | str]:
    """Refresh metadata for locked members from SSI and vendor fallbacks."""
    from .market_sources import directory
    from .market_http import SourceUnavailable
    from .ssi_market_data import configured, market_data

    records = []
    source_used = "SSI"
    if configured():
        try:
            records = market_data().directory()
        except (SourceUnavailable, ValueError, KeyError, TypeError):
            pass
    if not records:
        source_used = "VCI"
        try:
            records = directory("VCI")
        except SourceUnavailable:
            records = directory("KBS")
            source_used = "KBS"
    listed = {row["symbol"]: row for row in records}
    client = SupabaseRestClient(Settings.from_env())
    try:
        symbols = client.active_symbols()
        rows = []
        missing = {row["symbol"] for row in symbols} - set(listed)
        for fallback in (("VCI", "KBS") if source_used == "SSI" else ("KBS",) if source_used == "VCI" else ()):
            if not missing:
                break
            try:
                for row in directory(fallback):
                    if row["symbol"] in missing:
                        listed[row["symbol"]] = row
                        missing.remove(row["symbol"])
            except SourceUnavailable:
                pass  # Retain known metadata for absent/deregistered tickers.
        for symbol in symbols:
            ticker = str(symbol["symbol"]).upper()
            listing = listed.get(ticker)
            exchange = str(listing["exchange"]).upper() if listing else MANUAL_EXCHANGE_OVERRIDES.get(ticker)
            if not exchange:
                continue
            # PostgREST validates the prospective insert before resolving a
            # conflict, so retain all non-null columns from the locked row.
            payload = {
                "symbol": symbol["symbol"],
                "sector": symbol["sector"],
                "active": True,
                "exchange": exchange,
            }
            if listing and listing.get("company_name"):
                payload["company_name"] = listing["company_name"]
            rows.append(payload)
        written = client.upsert("symbols", rows, "symbol")
        return {"status": "SUCCEEDED", "updated": written, "unmatched": len(symbols) - written, "source": source_used}
    finally:
        client.close()
