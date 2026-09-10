from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .analysis import analyze_bars
from .backtest_worker import process_backtests
from .eod import run_eod
from .disclosures import run_hnx_disclosures
from .fundamentals import run_fundamentals
from .alerts import send_eod_telegram_alerts
from .calibrate import calibrate_patterns
from .outcome_worker import evaluate_pending_outcomes
from .universe import load_universe
from .seed import seed_universe
from .exchanges import sync_exchanges


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
    seed = subparsers.add_parser("seed-universe")
    seed.add_argument("path", type=Path)
    subparsers.add_parser("sync-exchanges")
    analyze = subparsers.add_parser("analyze-json")
    analyze.add_argument("path", type=Path)
    eod = subparsers.add_parser("eod")
    eod.add_argument("--date", dest="trading_date", type=date.fromisoformat, default=date.today())
    eod.add_argument("--source", default="KBS", choices=("KBS", "VCI"))
    eod.add_argument("--lookback-days", type=int, default=10)
    eod.add_argument("--benchmark-lookback-days", type=int, default=None)
    eod.add_argument("--symbol-offset", type=int, default=0)
    eod.add_argument("--symbol-limit", type=int)
    eod.add_argument("--pause-seconds", type=float, default=6.5)
    worker = subparsers.add_parser("backtest-worker")
    worker.add_argument("--limit", type=int, default=3)
    subparsers.add_parser("collect-hnx-disclosures")
    fundamentals = subparsers.add_parser("collect-fundamentals")
    fundamentals.add_argument("--limit", type=int, default=5)
    fundamentals.add_argument("--symbol-offset", type=int, default=0)
    fundamentals.add_argument("--symbols", help="Comma-separated symbols; overrides --limit")
    alert = subparsers.add_parser("send-eod-alerts")
    alert.add_argument("--date", dest="trading_date", type=date.fromisoformat, default=date.today())
    outcomes = subparsers.add_parser("evaluate-outcomes")
    outcomes.add_argument("--date", dest="outcomes_date", type=date.fromisoformat, default=date.today())
    calibrate = subparsers.add_parser("calibrate")
    calibrate.add_argument("bars_path", type=Path)
    calibrate.add_argument("--pattern-types", default="ACCUMULATION_BASE,DOUBLE_BOTTOM,ASCENDING_TRIANGLE,BULL_FLAG")
    args = parser.parse_args()
    if args.command == "validate-universe":
        raise SystemExit(validate_universe(args.path))
    if args.command == "seed-universe":
        print(json.dumps(seed_universe(args.path), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "sync-exchanges":
        print(json.dumps(sync_exchanges(), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "analyze-json":
        print(json.dumps(analyze_bars(json.loads(args.path.read_text(encoding="utf-8"))), ensure_ascii=False, indent=2))
        raise SystemExit(0)
    if args.command == "eod":
        result = run_eod(
            args.trading_date,
            source=args.source,
            lookback_days=args.lookback_days,
            **({"benchmark_lookback_days": args.benchmark_lookback_days} if args.benchmark_lookback_days is not None else {}),
            symbol_offset=args.symbol_offset,
            symbol_limit=args.symbol_limit,
            pause_seconds=args.pause_seconds,
        )
        print(json.dumps(result, indent=2))
        raise SystemExit(0 if result["status"] == "SUCCEEDED" else 1)
    if args.command == "backtest-worker":
        result = process_backtests(args.limit)
        print(json.dumps(result, indent=2))
        raise SystemExit(0 if result["failed"] == 0 else 1)
    if args.command == "collect-hnx-disclosures":
        print(json.dumps(run_hnx_disclosures(), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "collect-fundamentals":
        result = run_fundamentals(args.limit, args.symbols.split(",") if args.symbols else None, args.symbol_offset)
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(0 if result["failed"] == 0 and result["periods"] > 0 else 1)
    if args.command == "send-eod-alerts":
        print(json.dumps(send_eod_telegram_alerts(args.trading_date), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "evaluate-outcomes":
        print(json.dumps(evaluate_pending_outcomes(args.outcomes_date), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "calibrate":
        bars = json.loads(args.bars_path.read_text(encoding="utf-8"))
        print(json.dumps(calibrate_patterns(bars, args.pattern_types.split(",")), ensure_ascii=False, indent=2))
        raise SystemExit(0)


if __name__ == "__main__":
    main()
