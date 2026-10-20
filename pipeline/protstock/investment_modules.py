"""Independent O'Neil research and weekly price-cycle views; no trade signals.

Only existing canonical prices are read. Fundamentals remain user-verified.
All thresholds below are Prot heuristics, not proprietary IBD ratings.
"""
from __future__ import annotations

import argparse
import json
from datetime import date
from statistics import mean, median

from .config import Settings
from .eod import _coherent_benchmark_rows, _confirmed_week_end, _stock_rows_as_of
from .price_basis import same_source_window, with_volume_segments, volume_window_is_comparable
from .supabase_rest import SupabaseRestClient
from .timeframes import aggregate_bars
from .wyckoff import classify_wyckoff

VERSION = "INVESTMENT_V1_20261020"


def _return(rows: list[dict], periods: int) -> float | None:
    if len(rows) <= periods:
        return None
    return round((float(rows[-1]["close"]) / float(rows[-periods - 1]["close"]) - 1) * 100, 3)


def _cycle(weeks: list[dict]) -> dict:
    if len(weeks) < 34:
        return {"state": "UNKNOWN", "reason": "INSUFFICIENT_CLOSED_WEEKS"}
    closes = [float(row["close"]) for row in weeks]
    ma = mean(closes[-30:])
    prior_ma = mean(closes[-34:-4])
    slope = (ma / prior_ma - 1) * 100
    recent = weeks[-8:]
    support = min(float(row["low"]) for row in recent)
    resistance = max(float(row["high"]) for row in recent)
    width = (resistance / support - 1) * 100
    prior_move = (closes[-9] / closes[-21] - 1) * 100
    evidence = {"ma30": round(ma, 4), "slope4_pct": round(slope, 2),
                "support": support, "resistance": resistance, "range_width_pct": round(width, 2),
                "prior_move_pct": round(prior_move, 2), "weekly_date": weeks[-1]["date"]}
    if closes[-1] > ma and slope > 1 and (_return(weeks, 8) or 0) > 3:
        return {**evidence, "state": "MARKUP", "reason": "ABOVE_RISING_MA30"}
    if closes[-1] < ma and slope < -1 and (_return(weeks, 8) or 0) < -3:
        return {**evidence, "state": "MARKDOWN", "reason": "BELOW_FALLING_MA30"}
    if width <= 35 and abs(slope) <= 3:
        if prior_move <= -12:
            return {**evidence, "state": "ACCUMULATION", "reason": "BASING_AFTER_DECLINE"}
        if prior_move >= 12:
            return {**evidence, "state": "DISTRIBUTION", "reason": "STALLING_AFTER_ADVANCE"}
    return {**evidence, "state": "UNKNOWN", "reason": "AMBIGUOUS_RANGE_OR_TREND"}


def cycle_assessment(weeks: list[dict], daily: list[dict]) -> dict:
    closed = [row for row in weeks if row.get("is_complete")]
    current = _cycle(closed)
    previous = _cycle(closed[:-1])
    candidate = current["state"]
    stable = candidate != "UNKNOWN" and candidate == previous["state"]
    state = candidate if stable or candidate == "UNKNOWN" else "TRANSITION"
    event = classify_wyckoff(daily) if len(daily) >= 45 else {"event": None}
    return {**current, "state": state, "candidate": candidate,
            "evidence_level": "SUPPORTED" if stable else "TENTATIVE" if candidate != "UNKNOWN" else "INSUFFICIENT",
            "closed_weeks": len(closed), "daily_event": event.get("event"),
            "daily_event_evidence": event.get("evidence") if event.get("event") else None,
            "invalidation": "BELOW_RANGE_SUPPORT" if candidate in {"ACCUMULATION", "MARKUP"}
                            else "ABOVE_RANGE_RESISTANCE" if candidate in {"DISTRIBUTION", "MARKDOWN"} else None}


def assess_prices(rows: list[dict], benchmark: list[dict], confirmed_week_end: date | None) -> dict:
    if len(rows) < 60 or not same_source_window(rows):
        return {"quality": "INSUFFICIENT", "setup": "UNKNOWN", "cycle": {"state": "UNKNOWN", "candidate": "UNKNOWN", "reason": "INSUFFICIENT_CANONICAL_HISTORY"}}
    close = float(rows[-1]["close"])
    prior = rows[-51:-1]
    pivot = max(float(row["high"]) for row in prior)
    support = min(float(row["low"]) for row in prior)
    width = (pivot / support - 1) * 100
    volume_ok = volume_window_is_comparable(rows[-51:])
    avg_volume = mean(float(row.get("volume") or 0) for row in prior)
    volume_ratio = float(rows[-1].get("volume") or 0) / avg_volume if avg_volume > 0 and volume_ok else None
    distance = (close / pivot - 1) * 100
    sma50 = mean(float(row["close"]) for row in rows[-50:])
    sma200 = mean(float(row["close"]) for row in rows[-200:]) if len(rows) >= 200 else None
    # A range proxy, not a claim that a full cup/handle or VCP has been found.
    base = 5 <= width <= 30
    setup = "BUILDING_BASE" if base else "OBSERVE"
    if base and -5 <= distance <= 0:
        setup = "NEAR_PIVOT"
    elif distance > 5:
        setup = "EXTENDED"
    elif base and 0 < distance <= 5 and volume_ratio is not None and volume_ratio >= 1.5:
        setup = "BREAKOUT"
    elif sma200 and close > sma200 and 0 <= (close / sma50 - 1) * 100 <= 3:
        setup = "PULLBACK"
    weekly = aggregate_bars(rows, "W", confirmed_week_end=confirmed_week_end)
    market_by_date = {row["date"]: row for row in benchmark}
    rs = {}
    for periods, label in ((63, "rs3m"), (126, "rs6m"), (252, "rs12m")):
        # A 252-bar return must span the same market sessions for every stock.
        # Suspended/missing sessions are not filled or counted as a full year.
        aligned = len(benchmark) > periods and len(rows) > periods and [r["date"] for r in rows[-periods - 1:]] == [r["date"] for r in benchmark[-periods - 1:]]
        ret = _return(rows, periods) if aligned else None
        rs[label] = ret
        first = rows[-periods - 1]["date"] if len(rows) > periods else None
        start, end = market_by_date.get(first), market_by_date.get(rows[-1]["date"])
        rs[f"{label}_excess"] = round(ret - (float(end["close"]) / float(start["close"]) - 1) * 100, 3) if ret is not None and start and end else None
    high52 = max(float(row["high"]) for row in rows[-252:]) if len(rows) >= 252 else None
    # Provider stock price contract is thousand VND/share.
    liquidity = median(float(row["close"]) * float(row.get("volume") or 0) * 1000 for row in rows[-20:])
    return {"quality": "VALID", "close": close, "setup": setup, "pivot": round(pivot, 4),
            "support": round(support, 4), "distance_pct": round(distance, 2),
            "volume_ratio50": round(volume_ratio, 3) if volume_ratio is not None else None,
            "range_width_pct": round(width, 2), "high52_distance_pct": round((close / high52 - 1) * 100, 2) if high52 else None,
            "liquidity_vnd": round(liquidity), "sma50": round(sma50, 4), "sma200": round(sma200, 4) if sma200 else None,
            **rs, "cycle": cycle_assessment(weekly, rows)}


def rank_strength(items: list[dict]) -> None:
    eligible = [item for item in items if item["evidence"].get("rs12m") is not None and item["evidence"].get("quality") == "VALID"]
    size = len(eligible)
    for item in items:
        evidence = item["evidence"]
        evidence["rs_universe_size"] = size
        evidence["rs_percentile"] = None
        if item in eligible and size >= 20:
            value = evidence["rs12m"]
            # Identical returns receive identical midranks, not arbitrary symbol ordering.
            below = sum(other["evidence"]["rs12m"] < value for other in eligible)
            equal = sum(other["evidence"]["rs12m"] == value for other in eligible)
            evidence["rs_percentile"] = round(100 * (below + (equal - 1) / 2) / (size - 1), 1)


def refresh(client: SupabaseRestClient, cutoff: date | None = None) -> dict:
    capacity = client._request("POST", "/rpc/investment_modules_capacity", json={})
    capacity.raise_for_status()
    if not capacity.json().get("allowed"):
        return {"status": "SKIPPED_CAPACITY", **capacity.json()}
    jobs = client._pages("job_runs", {"select": "trading_date,source_revision", "status": "eq.SUCCEEDED",
        "source_revision": "eq.core-rules-v0.0.0-trend1", "counts->>published_signals": "not.is.null",
        "order": "trading_date.desc,finished_at.desc"}, 1)
    if not jobs:
        raise ValueError("No published EOD available")
    end = date.fromisoformat(jobs[0]["trading_date"])
    if cutoff and cutoff != end:
        raise ValueError("Current-only refresh must use latest published EOD")
    publication_revision = jobs[0]["source_revision"]
    symbols = client.active_symbols()
    index = client.market_index("VNINDEX")
    benchmark = _coherent_benchmark_rows(client.index_price_history(index["id"], 430), end)
    week_end = _confirmed_week_end(client, end, benchmark)
    pending = []
    for stock in symbols:
        stored = _stock_rows_as_of(client.price_history(stock["id"], 430), end)
        daily = [{**row, "date": row["trading_date"]} for row in with_volume_segments(stored, [], as_of_date=end)]
        if not daily or daily[-1]["date"] != end.isoformat():
            evidence = {"quality": "MISSING_SESSION", "setup": "UNKNOWN", "cycle": {"state": "UNKNOWN", "candidate": "UNKNOWN", "reason": "MISSING_SESSION"}}
        else:
            evidence = assess_prices(daily, benchmark, week_end)
        evidence.update({"source": daily[-1].get("source") if daily else None,
                         "price_revision": daily[-1].get("data_revision") if daily else None,
                         "input_date": daily[-1]["date"] if daily else None})
        pending.append({"symbol_id": stock["id"], "as_of_date": end.isoformat(), "version": VERSION,
                        "source_revision": publication_revision, "evidence": evidence})
    rank_strength(pending)
    response = client._request("POST", "/rpc/publish_investment_modules", json={"p_rows": pending})
    response.raise_for_status()
    return response.json()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat)
    args = parser.parse_args()
    client = SupabaseRestClient(Settings.from_env())
    try:
        print(json.dumps(refresh(client, args.date), ensure_ascii=False), flush=True)
    finally:
        client.close()


if __name__ == "__main__":
    main()
