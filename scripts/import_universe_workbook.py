"""Convert the approved Prot universe workbook to the locked seed CSV.

Duplicate symbols must agree on sector/exchange; the row with an explicit
trading status wins. Never infer NORMAL from a blank workbook cell.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from openpyxl import load_workbook


HEADERS = ("STT", "Mã chứng khoán", "Tên đầy đủ", "Nhóm ngành", "Sàn niêm yết", "Trạng thái")
STATUS = {None: "UNKNOWN", "": "UNKNOWN", "Bình thường": "NORMAL", "Hạn chế giao dịch": "RESTRICTED", "Ngừng giao dịch": "SUSPENDED", "Huỷ niêm yết": "DELISTED", "Hủy niêm yết": "DELISTED"}
EXCHANGE = {"HSX": "HOSE", "HOSE": "HOSE", "HNX": "HNX", "UPCOM": "UPCOM"}


def convert(source: Path, destination: Path, *, merge_existing: bool = False, exclude: frozenset[str] = frozenset()) -> tuple[int, int]:
    workbook = load_workbook(source, read_only=True, data_only=True)
    try:
        sheet = workbook.active
        rows = sheet.values
        if tuple(next(rows)) != HEADERS:
            raise ValueError("Unexpected universe workbook headers")
        by_symbol: dict[str, dict[str, str]] = {}
        duplicates = 0
        for number, row in enumerate(rows, start=2):
            if not any(value is not None for value in row):
                continue
            _, symbol, company_name, sector, exchange, status = row
            symbol = str(symbol or "").strip().upper()
            status_text = str(status).strip() if status is not None else None
            if status_text not in STATUS:
                raise ValueError(f"Unknown trading status at row {number}: {status_text!r}")
            exchange_text = str(exchange or "").strip().upper()
            if exchange_text not in EXCHANGE:
                raise ValueError(f"Unknown exchange at row {number}: {exchange_text!r}")
            item = {
                "symbol": symbol,
                "company_name": str(company_name or "").strip(),
                "sector": str(sector or "").strip(),
                "exchange": EXCHANGE[exchange_text],
                "trading_status": STATUS[status_text],
                "active": "true",
            }
            prior = by_symbol.get(symbol)
            if prior:
                duplicates += 1
                if (prior["sector"], prior["exchange"]) != (item["sector"], item["exchange"]):
                    raise ValueError(f"Conflicting duplicate symbol {symbol}")
                if prior["trading_status"] != "UNKNOWN" and item["trading_status"] == "UNKNOWN":
                    continue
            by_symbol[symbol] = item
        if merge_existing:
            with destination.open("r", encoding="utf-8-sig", newline="") as handle:
                existing = {row["symbol"]: row for row in csv.DictReader(handle)}
            if set(by_symbol) != set(existing) - exclude:
                raise ValueError("Workbook symbols differ from the existing universe beyond explicit exclusions")
            for symbol, item in by_symbol.items():
                item["company_name"] = existing[symbol]["company_name"]
                item["exchange"] = existing[symbol]["exchange"]
                item["active"] = existing[symbol]["active"]
        if exclude & set(by_symbol):
            raise ValueError("Excluded symbol is still present in workbook")
        with destination.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["symbol", "company_name", "sector", "exchange", "trading_status", "active"], lineterminator="\n")
            writer.writeheader()
            writer.writerows(by_symbol.values())
        return len(by_symbol), duplicates
    finally:
        workbook.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--merge-existing", action="store_true")
    parser.add_argument("--exclude", action="append", default=[])
    args = parser.parse_args()
    print(convert(args.source, args.destination, merge_existing=args.merge_existing, exclude=frozenset(args.exclude)))
