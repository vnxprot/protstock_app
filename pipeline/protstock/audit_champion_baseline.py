"""Read-only audit of published Champion signal cohorts on verified research prices.

This is a signal-cohort study, not a portfolio NAV backtest. Missing verified
series or point-in-time evidence remain missing instead of being imputed.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from statistics import mean

from .backtest import BacktestAssumptions
from .analysis import ALGORITHM_VERSION
from .config import Settings, vietnam_today
from .provider_vnstock import KBS_SOURCE_VERSION, STOCK_PRICE_UNIT
from .supabase_rest import SupabaseRestClient
from .universe import load_universe

START = "2025-01-01"


def load_from_supabase(end: str | None) -> dict:
    client = SupabaseRestClient(Settings.from_env())
    try:
        symbols = client.all_symbols_for_replay()
        manifest = load_universe(Path("data/universe.csv"))
        if not manifest.is_valid:
            raise ValueError("The current universe manifest is invalid")
        requested_end = end or vietnam_today().isoformat()
        breadth = client.breadth_history(date.fromisoformat(START), date.fromisoformat(requested_end))
        effective_end = end or max((row["trading_date"] for row in breadth), default=None)
        if effective_end is None:
            raise ValueError("No completed breadth session is available for the audit")
        signals = client._pages("consolidated_signals", {
            "select": "symbol_id,as_of_date,timeframe,composite_action,source_revision,consensus_engines",
            "as_of_date": f"gte.{START}", "and": f"(as_of_date.lte.{effective_end})", "timeframe": "eq.D"})
        evidence = client._pages("signals", {
            "select": "symbol_id,as_of_date,timeframe,action,evidence", "as_of_date": f"gte.{START}",
            "and": f"(as_of_date.lte.{effective_end})", "timeframe": "eq.D"})
        bars, statuses = {}, {}
        for symbol in symbols:
            key = str(symbol["id"])
            statuses[key] = client.research_price_status(symbol["id"])
            if (statuses[key] and statuses[key].get("coverage_status") == "MATCHED"
                    and statuses[key].get("source_version") == KBS_SOURCE_VERSION
                    and statuses[key].get("requested_start_date", "9999") <= START
                    and statuses[key].get("requested_end_date", "") >= effective_end):
                bars[key] = client.research_price_history(symbol["id"], 5000)
        return {"audit_end": effective_end, "symbols": symbols, "universe_manifest": [row.symbol for row in manifest.rows if row.active],
                "universe_manifest_sha256": manifest.sha256, "breadth": breadth, "champion_signals": signals,
                "raw_signals": evidence, "bars": bars, "price_status": statuses}
    finally:
        client.close()


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * fraction)]


def analyze(snapshot: dict, end: str) -> dict:
    config = BacktestAssumptions()
    current_symbols = [row for row in snapshot.get("symbols", []) if row.get("active", True)]
    current_names = {row["symbol"] for row in current_symbols}
    manifest_supplied = bool(snapshot.get("universe_manifest"))
    manifest = set(snapshot.get("universe_manifest") or ())
    universe_mismatch = sorted(current_names ^ manifest)
    breadth = {row["trading_date"]: row for row in snapshot.get("breadth", [])}
    raw = defaultdict(list)
    for row in snapshot.get("raw_signals", []):
        raw[(str(row["symbol_id"]), row["as_of_date"], row["action"])].append(row.get("evidence") or {})
    valid = {}
    skipped = {}
    for symbol in current_symbols:
        key = str(symbol["id"])
        status = (snapshot.get("price_status") or {}).get(key) or {}
        rows = (snapshot.get("bars") or {}).get(key) or []
        if (not rows or status.get("coverage_status") != "MATCHED" or status.get("source_version") != KBS_SOURCE_VERSION
                or status.get("requested_start_date", "9999") > START or status.get("requested_end_date", "") < end
                or any(row.get("quality_status") != "VALID"
                       or row.get("price_unit") != STOCK_PRICE_UNIT
                       or row.get("basis") != "KBS_VENDOR_REBASED"
                       or row.get("source_version") != KBS_SOURCE_VERSION for row in rows)):
            skipped[key] = "RESEARCH_PRICE_COVERAGE_UNVERIFIED"
            continue
        valid[key] = sorted(rows, key=lambda row: row["trading_date"])
    samples = []
    missing = defaultdict(int)
    for signal in snapshot.get("champion_signals", []):
        if signal.get("composite_action") not in {"PROBE_BUY", "ADD"} or signal.get("timeframe") != "D":
            continue
        day = signal["as_of_date"]
        if not START <= day <= end:
            continue
        key = str(signal["symbol_id"])
        rows = valid.get(key)
        if not rows:
            missing["unverified_price"] += 1
            continue
        at = next((i for i, row in enumerate(rows) if row["trading_date"] == day), None)
        if at is None or at + 3 >= len(rows):
            missing["immature_t_plus"] += 1
            continue
        entry_at = at + 1
        entry = float(rows[entry_at]["open"]) * (1 + config.slippage_rate)
        if entry <= 0:
            missing["invalid_entry"] += 1
            continue
        t2 = rows[entry_at + 2]
        t2_net = float(t2["close"]) * (1 - config.fee_rate - config.sell_tax_rate)
        t2_return = t2_net / (entry * (1 + config.fee_rate)) - 1
        low = min(float(row["low"]) for row in rows[entry_at:entry_at + 3])
        locked_drawdown = low / entry - 1
        evidences = raw[(key, day, signal["composite_action"])]
        stop = next((float(item["invalidation_price"]) for item in evidences
                     if item.get("invalidation_price")), None)
        pivot = next((float(item.get("base_price") or item.get("trigger_price")) for item in evidences
                      if item.get("base_price") or item.get("trigger_price")), None)
        stop_distance = (entry / stop - 1) * 100 if stop and stop > 0 else None
        base_distance = (entry / pivot - 1) * 100 if pivot and pivot > 0 else None
        regime = (breadth.get(day) or {}).get("vnindex_trend_state") or "UNKNOWN"
        future = rows[entry_at + 20] if entry_at + 20 < len(rows) else None
        return_20 = (float(future["close"]) *
                     (1 - config.fee_rate - config.sell_tax_rate) / (entry * (1 + config.fee_rate)) - 1) if future else None
        t3 = rows[entry_at + 3] if entry_at + 3 < len(rows) else None
        t3_net = float(t3["close"]) * (1 - config.fee_rate - config.sell_tax_rate) if t3 else None
        samples.append({"symbol_id": key, "date": day, "regime": regime,
                        "revision": signal.get("source_revision") or "UNKNOWN",
                        "engines": signal.get("consensus_engines") or [], "stop_distance_pct": stop_distance,
                        "base_distance_pct": base_distance,
                        "locked_drawdown": locked_drawdown, "t_plus_return": t2_return,
                        "return_20": return_20,
                        "bull_trap": t3_net is not None and float(rows[entry_at]["close"]) > entry
                        and t3_net / (entry * (1 + config.fee_rate)) - 1 < 0})
    signal_dates = sorted(row["as_of_date"] for row in snapshot.get("champion_signals", []))
    revisions = dict(Counter(row.get("source_revision") or "UNKNOWN" for row in snapshot.get("champion_signals", [])))
    expected_sessions = {day for day in breadth if START <= day <= end}
    unrepresented_sessions = sorted(expected_sessions - set(signal_dates))
    return {"symbols_total": len(current_symbols), "symbols_verified": len(valid),
            "universe_manifest_sha256": snapshot.get("universe_manifest_sha256"),
            "manifest_supplied": manifest_supplied,
            "universe_mismatch": universe_mismatch,
            "skipped_symbols": skipped, "samples": samples, "missing": dict(missing),
            "signal_first_date": signal_dates[0] if signal_dates else None,
            "signal_last_date": signal_dates[-1] if signal_dates else None,
            "champion_revisions": revisions,
            "breadth_session_count": len(expected_sessions),
            "unrepresented_sessions": unrepresented_sessions,
            "complete": manifest_supplied and bool(current_symbols) and len(current_names) == len(current_symbols)
            and not universe_mismatch and len(valid) == len(current_symbols) and not missing
            and bool(expected_sessions) and not unrepresented_sessions
            and revisions == {ALGORITHM_VERSION: len(signal_dates)}
            and bool(signal_dates) and signal_dates[0] <= "2025-01-31" and signal_dates[-1] >= end}


def render_report(result: dict, end: str) -> str:
    samples = result["samples"]
    stop_distances = [row["stop_distance_pct"] for row in samples if row["stop_distance_pct"] is not None]
    base_distances = [row["base_distance_pct"] for row in samples if row["base_distance_pct"] is not None]
    locked = [row["locked_drawdown"] for row in samples]
    lines = ["# Kiểm toán Champion 2025–2026", "",
             f"Kỳ tín hiệu: {START} đến {end}. Dữ liệu: tín hiệu Champion đã lưu và chuỗi giá nghiên cứu KBS được xác minh.", "",
             f"**Trạng thái: {'ĐỦ PHỦ' if result['complete'] else 'CHƯA ĐỦ PHỦ – không dùng làm ground truth'}**. "
             f"Mã có giá đạt chuẩn: {result['symbols_verified']}/{result['symbols_total']}; "
             f"lượt mua D đủ tuổi T+2: {len(samples)}.", "",
             f"Dải ngày tín hiệu lưu trữ: {result['signal_first_date'] or '—'} đến {result['signal_last_date'] or '—'}.",
             f"Phiên breadth có ít nhất một tín hiệu Champion: {result['breadth_session_count'] - len(result['unrepresented_sessions'])}/{result['breadth_session_count']}.",
             f"Phiên bản Champion trong mẫu: {result['champion_revisions']} (phiên bản hiện hành: {ALGORITHM_VERSION}).",
             f"Universe manifest SHA-256: {result.get('universe_manifest_sha256') or 'không có trong bản xuất'}.", "",
             "Đây là nghiên cứu theo lượt tín hiệu, không phải lợi suất NAV danh mục. Các lượt có thể trùng mã/ngày; "
             "lợi suất 20 phiên là giữ cố định, chưa mô phỏng tái cân bằng danh mục. "
             "Đáy OHLC của T+2 là proxy bảo thủ cho buổi sáng, không xác định được giờ xảy ra.", ""]
    if result["skipped_symbols"]:
        lines += [f"Mã bị loại do giá chưa xác minh: {len(result['skipped_symbols'])}.", ""]
    if result["universe_mismatch"]:
        lines += [f"Universe trong nguồn không khớp manifest: {', '.join(result['universe_mismatch'])}.", ""]
    if result["missing"]:
        lines += [f"Lượt tín hiệu bị loại: {result['missing']}.", ""]
    if not samples:
        lines += ["Chưa có số liệu đủ điều kiện để báo cáo.", ""]
        return "\n".join(lines)
    lines += ["## Điểm vào và rủi ro T+", "",
              f"Khoảng cách entry tới pivot/base: đủ bằng chứng {len(base_distances)}/{len(samples)} lượt; "
              f"trung vị {_percentile(base_distances, .5):.2f}% và P90 {_percentile(base_distances, .9):.2f}%." if base_distances else "Không đủ bằng chứng pivot/base để đo độ trễ.",
              f"Khoảng cách entry tới invalidation stop: đủ bằng chứng {len(stop_distances)}/{len(samples)} lượt; "
              f"trung vị {_percentile(stop_distances, .5):.2f}% và P90 {_percentile(stop_distances, .9):.2f}%." if stop_distances else "Không đủ bằng chứng stop để đo khoảng cách rủi ro.",
              f"Tỷ lệ khoảng cách >5% / >8% / >12%: " + " / ".join(
                  f"{sum(value > threshold for value in base_distances) / len(base_distances):.1%}" for threshold in (5, 8, 12)) if base_distances else "",
              f"Sụt giảm trong cửa sổ khóa: trung bình {mean(locked):.2%}, xấu nhất {min(locked):.2%}.",
              f"Thắng tại T+2 close sau chi phí: {sum(row['t_plus_return'] > 0 for row in samples) / len(samples):.1%}.",
              f"Bull trap (lãi close ngày mua, lỗ tại T+3): {sum(row['bull_trap'] for row in samples) / len(samples):.1%}.", "",
              "## Tổn thương theo nhóm bộ máy", ""]
    for name, token in (("Core", "core"), ("MACD", "macd")):
        group = [row for row in samples if any(token in str(engine).lower() for engine in row["engines"])]
        lines.append(f"- {name}: {len(group)} lượt; sụt giảm khóa trung bình "
                     f"{mean(row['locked_drawdown'] for row in group):.2%}." if group else
                     f"- {name}: chưa có lượt đủ điều kiện.")
    lines += ["",
              "## Hiệu suất theo trạng thái VN-Index", "",
              "| Trạng thái | Lượt đủ T+ | T+ thắng | Lượt đủ 20 phiên | Lợi suất 20 phiên TB | Win rate 20 phiên | Profit factor 20 phiên |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for regime in ("UP", "SIDEWAYS", "DOWN", "UNKNOWN"):
        group = [row for row in samples if row["regime"] == regime]
        mature = [row["return_20"] for row in group if row["return_20"] is not None]
        wins = sum(value > 0 for value in mature)
        gains = sum(value for value in mature if value > 0)
        losses = abs(sum(value for value in mature if value < 0))
        lines.append(f"| {regime} | {len(group)} | {sum(row['t_plus_return'] > 0 for row in group) / len(group):.1%} "
                     f"| {len(mature)} | {mean(mature):.2%} | {wins / len(mature):.1%} | {gains / losses:.2f} |"
                     if group and mature and losses else
                     f"| {regime} | {len(group)} | {sum(row['t_plus_return'] > 0 for row in group) / len(group):.1%} | "
                     f"{len(mature)} | {'—' if not mature else f'{mean(mature):.2%}'} | "
                     f"{'—' if not mature else f'{wins / len(mature):.1%}'} | — |" if group else
                     f"| {regime} | 0 | — | 0 | — | — | — |")
    lines += ["", "Các ngưỡng Challenger chỉ nên hiệu chỉnh sau khi đủ dữ liệu điều chỉnh giá, "
              "cùng tập mẫu cho Champion và Challenger, và một giai đoạn quan sát ngoài mẫu.", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only Champion baseline audit")
    parser.add_argument("--snapshot", type=Path, help="JSON export matching the audit input contract")
    parser.add_argument("--end", help="Completed EOD session; default is the latest stored breadth session")
    parser.add_argument("--output", type=Path, default=Path("docs/champion-baseline-audit-2026-10.md"))
    parser.add_argument("--require-complete", action="store_true", help="Exit nonzero if the historical cohort is not fully verified")
    args = parser.parse_args()
    source = json.loads(args.snapshot.read_text(encoding="utf-8")) if args.snapshot else load_from_supabase(args.end)
    end = args.end or source.get("audit_end") or max((row["trading_date"] for row in source.get("breadth", [])), default=None)
    if end is None:
        raise ValueError("Audit end date is required when the snapshot has no breadth sessions")
    result = analyze(source, end)
    args.output.write_text(render_report(result, end), encoding="utf-8")
    print(f"verified_symbols={result['symbols_verified']}/{result['symbols_total']} samples={len(result['samples'])} complete={result['complete']}")
    if args.require_complete and not result["complete"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
