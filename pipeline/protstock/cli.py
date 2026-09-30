from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from .analysis import analyze_bars
from .backtest_worker import process_backtests
from .eod import finalize_fast_lane, rebuild_market_health, rebuild_signals, run_eod
from .alerts import send_eod_telegram_alerts
from .calibrate import calibrate_patterns
from .outcome_worker import evaluate_pending_outcomes
from .funnel_replay import run_funnel_replay
from .pattern_archive import archive_pattern_evidence
from .universe import load_universe
from .seed import seed_universe, seed_vnindex_history
from .repair_history import repair_missing_history
from .history_coverage import audit_history_coverage
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
    seed_vnindex = subparsers.add_parser("seed-vnindex")
    seed_vnindex.add_argument("--start-date", type=date.fromisoformat, default=date(2018, 1, 1))
    seed_vnindex.add_argument("--end-date", type=date.fromisoformat, default=date.today())
    seed_vnindex.add_argument("--source", default="KBS", choices=("KBS",))
    repair = subparsers.add_parser("repair-history")
    repair.add_argument("--start-date", type=date.fromisoformat, default=date(2021, 1, 1))
    repair.add_argument("--end-date", type=date.fromisoformat, default=date.today())
    repair.add_argument("--source", default="KBS", choices=("KBS",))
    repair.add_argument("--symbol-offset", type=int, default=0)
    repair.add_argument("--symbol-limit", type=int)
    repair.add_argument("--pause-seconds", type=float, default=3.0)
    repair.add_argument("--symbols", help="Comma-separated symbols; overrides the offset range")
    repair.add_argument("--full-range", action="store_true", help="For explicit symbols, backfill every available source bar in the requested range")
    coverage = subparsers.add_parser("history-coverage")
    coverage.add_argument("--start-date", type=date.fromisoformat, default=date(2021, 1, 1))
    coverage.add_argument("--end-date", type=date.fromisoformat, default=date.today())
    subparsers.add_parser("sync-exchanges")
    analyze = subparsers.add_parser("analyze-json")
    analyze.add_argument("path", type=Path)
    eod = subparsers.add_parser("eod")
    eod.add_argument("--date", dest="trading_date", type=date.fromisoformat, default=date.today())
    eod.add_argument("--source", default="KBS", choices=("KBS",))
    eod.add_argument("--lookback-days", type=int, default=10)
    eod.add_argument("--benchmark-lookback-days", type=int, default=None)
    eod.add_argument("--symbol-offset", type=int, default=0)
    eod.add_argument("--symbol-limit", type=int)
    eod.add_argument("--pause-seconds", type=float, default=6.5)
    eod.add_argument("--fast-lane", action="store_true")
    eod.add_argument("--skip-breadth-snapshot", action="store_true")
    eod.add_argument("--historical", action="store_true", help="Do not use today's portfolio for a historical EOD date")
    finalize_fast = subparsers.add_parser("finalize-fast-eod")
    finalize_fast.add_argument("--date", dest="trading_date", type=date.fromisoformat, default=date.today())
    finalize_fast.add_argument("--allow-partial", action="store_true", help="Publish available same-day data without retrying missing symbols")
    health = subparsers.add_parser("rebuild-market-health")
    health.add_argument("--start-date", type=date.fromisoformat, default=date(2021, 1, 1))
    health.add_argument("--end-date", type=date.fromisoformat, default=date.today())
    rebuild = subparsers.add_parser("rebuild-signals")
    rebuild.add_argument("--date", dest="trading_date", type=date.fromisoformat, default=date.today())
    rebuild.add_argument("--symbol-offset", type=int, default=0)
    rebuild.add_argument("--symbol-limit", type=int)
    rebuild.add_argument("--historical", action="store_true", help="Do not use today's portfolio for a historical rebuild")
    worker = subparsers.add_parser("backtest-worker")
    worker.add_argument("--limit", type=int, default=3)
    alert = subparsers.add_parser("send-eod-alerts")
    alert.add_argument("--date", dest="trading_date", type=date.fromisoformat, default=date.today())
    outcomes = subparsers.add_parser("evaluate-outcomes")
    outcomes.add_argument("--date", dest="outcomes_date", type=date.fromisoformat, default=date.today())
    funnel = subparsers.add_parser("replay-funnel")
    funnel.add_argument("--start-date", type=date.fromisoformat, required=True)
    funnel.add_argument("--end-date", type=date.fromisoformat, required=True)
    funnel.add_argument("--symbol-offset", type=int, default=0)
    funnel.add_argument("--symbol-limit", type=int)
    funnel.add_argument("--apply", action="store_true")
    calibrate = subparsers.add_parser("calibrate")
    calibrate.add_argument("bars_path", type=Path)
    calibrate.add_argument("--pattern-types", default="ACCUMULATION_BASE,DOUBLE_BOTTOM,ASCENDING_TRIANGLE,BULL_FLAG")
    archive = subparsers.add_parser("archive-pattern-evidence")
    archive.add_argument("--retention-days", type=int, default=180)
    archive.add_argument("--date", dest="archive_date", type=date.fromisoformat, default=date.today())
    args = parser.parse_args()
    if args.command == "validate-universe":
        raise SystemExit(validate_universe(args.path))
    if args.command == "seed-universe":
        print(json.dumps(seed_universe(args.path), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "seed-vnindex":
        print(json.dumps(seed_vnindex_history(args.start_date, args.end_date, args.source), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "repair-history":
        result = repair_missing_history(args.start_date, args.end_date, source=args.source, symbol_offset=args.symbol_offset, symbol_limit=args.symbol_limit, symbols={item.strip().upper() for item in args.symbols.split(",") if item.strip()} if args.symbols else None, pause_seconds=args.pause_seconds, full_range=args.full_range)
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(0 if result["status"] in {"SUCCEEDED", "PARTIAL"} else 1)
    if args.command == "history-coverage":
        print(json.dumps(audit_history_coverage(args.start_date, args.end_date), ensure_ascii=False, indent=2))
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
            fast_lane=args.fast_lane,
            write_breadth_snapshot=not args.skip_breadth_snapshot,
            historical=args.historical,
        )
        print(json.dumps(result, indent=2))
        raise SystemExit(0 if result["status"] in {"SUCCEEDED", "PARTIAL"} else 1)
    if args.command == "finalize-fast-eod":
        print(json.dumps(finalize_fast_lane(args.trading_date, allow_partial=args.allow_partial), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "rebuild-market-health":
        print(json.dumps(rebuild_market_health(args.start_date, args.end_date), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "rebuild-signals":
        result = rebuild_signals(args.trading_date, symbol_offset=args.symbol_offset, symbol_limit=args.symbol_limit, historical=args.historical)
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(0 if result["status"] in {"SUCCEEDED", "PARTIAL"} else 1)
    if args.command == "backtest-worker":
        result = process_backtests(args.limit)
        print(json.dumps(result, indent=2))
        raise SystemExit(0 if result["failed"] == 0 else 1)
    if args.command == "send-eod-alerts":
        print(json.dumps(send_eod_telegram_alerts(args.trading_date), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "evaluate-outcomes":
        print(json.dumps(evaluate_pending_outcomes(args.outcomes_date), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "replay-funnel":
        print(json.dumps(run_funnel_replay(args.start_date, args.end_date,
                                           symbol_offset=args.symbol_offset,
                                           symbol_limit=args.symbol_limit,
                                           apply=args.apply), ensure_ascii=False))
        raise SystemExit(0)
    if args.command == "calibrate":
        bars = json.loads(args.bars_path.read_text(encoding="utf-8"))
        print(json.dumps(calibrate_patterns(bars, args.pattern_types.split(",")), ensure_ascii=False, indent=2))
        raise SystemExit(0)
    if args.command == "archive-pattern-evidence":
        print(json.dumps(archive_pattern_evidence(args.retention_days, args.archive_date), ensure_ascii=False))
        raise SystemExit(0)


if __name__ == "__main__":
    main()
