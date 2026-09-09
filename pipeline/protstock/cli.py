from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .analysis import analyze_bars
from .eod import run_eod
from .universe import load_universe


def validate_universe(path: Path) -> int:
    result = load_universe(path)
    tdc = [row for row in result.rows if row.symbol == "TDC"]
    payload = {
        "rows": len(result.rows),
        "unique": len({row.symbol for row in result.rows}),
        "duplicates": result.duplicates,
        "invalid": result.invalid,
        "active": sum(row.active for row in result.rows),
        "tdc": [{"sector": row.sector, "active": row.active} for row in tdc],
        "sha256": result.sha256,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if result.is_valid else 1


def main() -> None:
    parser = argparse.ArgumentParser(prog="protstock")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate-universe")
    validate.add_argument("path", type=Path)
    analyze = subparsers.add_parser("analyze-json")
    analyze.add_argument("path", type=Path)
    eod = subparsers.add_parser("eod")
    eod.add_argument("--date", dest="trading_date", type=date.fromisoformat, default=date.today())
    eod.add_argument("--source", default="KBS", choices=("KBS", "VCI"))
    eod.add_argument("--lookback-days", type=int, default=10)
    eod.add_argument("--symbol-limit", type=int)
    args = parser.parse_args()
    if args.command == "validate-universe":
        raise SystemExit(validate_universe(args.path))
    if args.command == "analyze-json":
        print(json.dumps(analyze_bars(json.loads(args.path.read_text(encoding="utf-8"))), ensure_ascii=False, indent=2))
        raise SystemExit(0)
    if args.command == "eod":
        print(json.dumps(run_eod(args.trading_date, source=args.source, lookback_days=args.lookback_days, symbol_limit=args.symbol_limit), indent=2))
        raise SystemExit(0)


if __name__ == "__main__":
    main()
