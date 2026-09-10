from __future__ import annotations

from .config import Settings
from .supabase_rest import SupabaseRestClient

MANUAL_EXCHANGE_OVERRIDES = {
    # LTG was removed from the live Vnstock directory after its UPCOM
    # deregistration; retain the last official board for the locked universe.
    "LTG": "UPCOM",
}

def sync_exchanges() -> dict[str, int | str]:
    """Refresh exchange and issuer labels from the public Vnstock directory."""
    try:
        from vnstock import Listing
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Install the data extra: pip install -e '.[data]'") from exc

    directory = Listing().symbols_by_exchange(exchange="HOSE")
    columns = {str(column).lower(): str(column) for column in directory.columns}
    required = {"symbol", "exchange"}
    if not required.issubset(columns):
        raise ValueError("Vnstock directory did not return symbol/exchange columns")
    records = directory.to_dict(orient="records")
    listed = {
        str(row[columns["symbol"]]).strip().upper(): row
        for row in records
        if str(row.get(columns["exchange"], "")).upper() in {"HOSE", "HNX", "UPCOM"}
    }
    client = SupabaseRestClient(Settings.from_env())
    try:
        symbols = client.active_symbols()
        rows = []
        for symbol in symbols:
            ticker = str(symbol["symbol"]).upper()
            listing = listed.get(ticker)
            exchange = str(listing[columns["exchange"]]).upper() if listing else MANUAL_EXCHANGE_OVERRIDES.get(ticker)
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
            company_column = columns.get("organ_name")
            if listing and company_column and listing.get(company_column):
                payload["company_name"] = str(listing[company_column]).strip()
            rows.append(payload)
        written = client.upsert("symbols", rows, "symbol")
        return {"status": "SUCCEEDED", "updated": written, "unmatched": len(symbols) - written}
    finally:
        client.close()
