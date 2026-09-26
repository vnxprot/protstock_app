"""One-time repair for raw-VND KBS stock rows written on 2026-09-25."""

from __future__ import annotations

import argparse
import json
from datetime import date

from .config import Settings
from .supabase_rest import SupabaseRestClient


def normalize_rows(rows: list[dict]) -> list[dict]:
    """Select only unmistakably raw-VND stock rows; safe to re-run."""
    result = []
    for row in rows:
        values = [float(row[key]) for key in ("open", "high", "low", "close")]
        if row["source"] != "KBS_PUBLIC" or min(values) < 100:
            continue
        result.append({**row, "source": "KBS_PUBLIC_REPAIRED", **{key: float(row[key]) / 1000 for key in ("open", "high", "low", "close")}})
    return result


def repair(trading_date: date, *, apply: bool = False) -> dict:
    if trading_date != date(2026, 9, 25):
        raise ValueError("This repair is limited to 2026-09-25")
    client = SupabaseRestClient(Settings.from_env())
    try:
        rows = client.stock_prices_by_source_and_date("KBS_PUBLIC", trading_date)
        candidates = normalize_rows(rows)
        if len(candidates) != len(rows):
            raise ValueError("Some KBS rows do not match the raw-VND repair guard")
        candidate_ids = {row["symbol_id"] for row in candidates}
        skipped = [{"symbol_id": row["symbol_id"], "close": row["close"]} for row in rows if row["symbol_id"] not in candidate_ids]
        if apply:
            for offset in range(0, len(candidates), 100):
                client.upsert("daily_prices", candidates[offset:offset + 100], "symbol_id,trading_date")
        return {"date": trading_date.isoformat(), "mode": "apply" if apply else "dry-run", "source_rows": len(rows), "corrected_rows": len(candidates) if apply else 0, "candidate_rows": len(candidates), "skipped": skipped}
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=date.fromisoformat, required=True)
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    print(json.dumps(repair(arguments.date, apply=arguments.apply)))
