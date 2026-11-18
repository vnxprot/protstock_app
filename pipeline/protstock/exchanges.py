from __future__ import annotations

from .config import Settings
from .supabase_rest import SupabaseRestClient

MANUAL_EXCHANGE_OVERRIDES = {
    # LTG was removed from the live vendor directory after its UPCOM
    # deregistration; retain the last official board for the locked universe.
    "LTG": "UPCOM",
}

def sync_exchanges() -> dict[str, int | str]:
    """Use direct VCI membership, with direct KBS for outages or missing tickers."""
    from .market_sources import directory
    from .market_http import SourceUnavailable

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
        if missing and source_used == "VCI":
            try:
                for row in directory("KBS"):
                    if row["symbol"] in missing:
                        listed[row["symbol"]] = row
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
