"""End-of-day, minute-bar volume anomaly research for the active universe."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import median
from time import sleep

import httpx

from .config import Settings
from .price_basis import source_family
from .market_sources import vci_candles
from .market_http import SourceUnavailable, request_json
from .supabase_rest import SupabaseRestClient

VERSION = "INTRADAY_SPIKE_V0.0.0"
SOURCE = "VCI_DIRECT_1M"
WINDOWS = (1, 3, 5, 15)
MIN_BASELINE_SESSIONS = 10
MIN_VALUE_VND = 100_000_000
MIN_RATIO = 3.0
RETENTION_DAYS = 50  # About 30 trading sessions; event history is retained.


def _minute_of_day(time_text: str) -> int:
    hour, minute = (int(part) for part in time_text.split(":"))
    return hour * 60 + minute


def _session(time_text: str) -> int | None:
    minute = _minute_of_day(time_text)
    if 9 * 60 <= minute <= 11 * 60 + 30:
        return 1
    if 13 * 60 <= minute <= 14 * 60 + 45:
        return 2
    return None


def parse_minute_bars(payload: dict, symbol: str, start: date, end: date) -> dict[str, list[dict]]:
    records = payload.get("data_1P") or payload.get("data_1p") or payload.get("data") or []
    if not isinstance(records, list):
        raise ValueError(f"Unexpected minute payload for {symbol}")
    days: dict[str, dict[str, dict]] = defaultdict(dict)
    for record in records:
        raw_time = str(record.get("t") or record.get("time") or "")
        if len(raw_time) < 16:
            continue
        day, minute = raw_time[:10], raw_time[11:16]
        try:
            parsed_day = date.fromisoformat(day)
            if not start <= parsed_day <= end or _session(minute) is None:
                continue
            o, h, l, c = (float(record[key]) for key in ("o", "h", "l", "c"))
            volume = int(float(record.get("v") or 0))
        except (ValueError, TypeError, KeyError):
            continue
        if min(o, h, l, c) <= 0 or volume < 0 or h < max(o, c) or l > min(o, c):
            continue
        days[day][minute] = {"t": minute, "o": o, "h": h, "l": l, "c": c, "v": volume}
    return {day: sorted(by_time.values(), key=lambda bar: bar["t"]) for day, by_time in days.items()}


def _window(day_map: dict[int, dict], start: int, length: int) -> list[dict] | None:
    start_time = f"{start // 60:02d}:{start % 60:02d}"
    end = start + length - 1
    end_time = f"{end // 60:02d}:{end % 60:02d}"
    session = _session(start_time)
    if session is None or _session(end_time) != session:
        return None
    # No recorded match in a minute means zero volume within a complete day.
    return [day_map[minute] for minute in range(start, end + 1) if minute in day_map]


def detect_events(symbol_id: int, trading_date: str, bars: list[dict], history: list[list[dict]]) -> list[dict]:
    """Compare rolling windows with matching clock minutes on prior complete days."""
    today = {_minute_of_day(bar["t"]): bar for bar in bars}
    historical = [{_minute_of_day(bar["t"]): bar for bar in day} for day in history]
    if len(historical) < MIN_BASELINE_SESSIONS:
        return []
    candidates: list[dict] = []
    for start in sorted(today):
        for length in WINDOWS:
            window = _window(today, start, length)
            if not window:
                continue
            volume = sum(int(bar.get("cv", bar["v"])) for bar in window)
            value = sum(float(bar["c"]) * int(bar["v"]) for bar in window)
            if value < MIN_VALUE_VND:
                continue
            baseline = []
            for earlier in historical:
                comparable = _window(earlier, start, length)
                if comparable:
                    baseline.append(sum(int(bar.get("cv", bar["v"])) for bar in comparable))
            if len(baseline) < MIN_BASELINE_SESSIONS:
                continue
            typical = median(baseline)
            if typical <= 0 or volume / typical < MIN_RATIO:
                continue
            candidates.append({"start": start, "end": start + length - 1, "ratio": volume / typical,
                               "baseline_sessions": len(baseline)})
    # Windows that describe one burst form one event. Adjacent disjoint bursts remain separate.
    candidates.sort(key=lambda item: (item["start"], item["end"]))
    merged: list[dict] = []
    for candidate in candidates:
        if merged and candidate["start"] <= merged[-1]["end"]:
            merged[-1]["end"] = max(merged[-1]["end"], candidate["end"])
            if candidate["ratio"] > merged[-1]["ratio"]:
                merged[-1]["ratio"] = candidate["ratio"]
                merged[-1]["baseline_sessions"] = candidate["baseline_sessions"]
        else:
            merged.append(dict(candidate))
    events = []
    final_close = float(bars[-1]["c"])
    for item in merged:
        segment = [today[minute] for minute in range(item["start"], item["end"] + 1) if minute in today]
        if not segment:
            continue
        opening, ending = float(segment[0]["o"]), float(segment[-1]["c"])
        change = (ending / opening - 1) * 100
        final_change = (final_close / opening - 1) * 100
        direction = "UP" if change >= 0.25 else "DOWN" if change <= -0.25 else "FLAT"
        if direction == "UP" and final_change < change * 0.5:
            direction = "REVERSED_UP"
        elif direction == "DOWN" and final_change > change * 0.5:
            direction = "REVERSED_DOWN"
        events.append({"symbol_id": symbol_id, "trading_date": trading_date,
                       "start_time": segment[0]["t"], "end_time": segment[-1]["t"],
                       "duration_minutes": item["end"] - item["start"] + 1,
                       "volume": sum(int(bar["v"]) for bar in segment),
                       "value_vnd": round(sum(float(bar["c"]) * int(bar["v"]) for bar in segment), 2),
                       "volume_ratio": round(item["ratio"], 3), "price_change_pct": round(change, 3),
                       "close_hold_pct": round(final_change / change * 100, 1) if abs(change) >= 0.25 else None,
                       "direction": direction, "baseline_sessions": item["baseline_sessions"],
                       "algorithm_version": VERSION, "source": SOURCE})
    return sorted(events, key=lambda event: float(event["volume_ratio"]), reverse=True)[:12]


def _fetch_vci_minutes(symbol: str, start: date, end: date) -> dict[str, list[dict]]:
    """Read public VCI candles directly; the raw endpoint uses VND/share."""
    return parse_minute_bars({"data": vci_candles(symbol, start, end, minute=True)}, symbol, start, end)


def _fetch_kbs_minutes(symbol: str, start: date, end: date) -> dict[str, list[dict]]:
    """Use KBS minutes only when the selected EOD series is also KBS."""
    payload = request_json("GET",
        f"https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/{symbol}/data_1P",
        params={"sdate": start.strftime("%d-%m-%Y"), "edate": (end + timedelta(days=1)).strftime("%d-%m-%Y")},
    )
    return parse_minute_bars(payload, symbol, start, end)


def run_intraday_spikes(trading_date: date, *, symbol_offset: int = 0, symbol_limit: int | None = None,
                        symbols: set[str] | None = None, pause_seconds: float = 1.2) -> dict:
    db = SupabaseRestClient(Settings.from_env())
    counts = {"symbols": 0, "complete": 0, "partial": 0, "empty": 0, "events": 0,
              "coverage_issues": [], "failed": []}
    try:
        universe = db.active_symbols()
        selected = [row for row in universe if row["symbol"] in symbols] if symbols else universe[symbol_offset:symbol_offset + symbol_limit if symbol_limit else None]
        cutoff = trading_date - timedelta(days=RETENTION_DAYS)
        for row in selected:
            counts["symbols"] += 1
            symbol_id, symbol = int(row["id"]), str(row["symbol"])
            symbol_status, baseline_count, minute_source, error = "EMPTY", 0, None, None
            try:
                stored = db._pages("intraday_minute_days", {
                    "select": "trading_date,bars,coverage_status,data_revision,source", "symbol_id": f"eq.{symbol_id}",
                    "trading_date": f"gte.{cutoff.isoformat()}", "order": "trading_date.desc"}, limit=65)
                daily = db._get("/daily_prices", params=[("select", "trading_date,open,high,low,close,source,source_volume,quality_status,data_revision"),
                    ("symbol_id", f"eq.{symbol_id}"), ("trading_date", f"gte.{cutoff.isoformat()}"),
                    ("trading_date", f"lte.{trading_date.isoformat()}"), ("limit", "65")])
                daily.raise_for_status()
                all_daily = {item["trading_date"]: item for item in daily.json()}
                current_daily = all_daily.get(trading_date.isoformat())
                if current_daily is None:
                    counts["empty"] += 1
                    counts["coverage_issues"].append({"symbol": symbol, "status": "EMPTY"})
                    continue
                family = source_family(current_daily.get("source"))
                if family not in {"VCI", "KBS"}:
                    raise ValueError("UNKNOWN_EOD_SOURCE")
                minute_source = SOURCE if family == "VCI" else "KBS_PUBLIC_1P"
                current_revision = current_daily.get("data_revision")
                if current_daily.get("quality_status") != "VALID" or not current_revision or current_daily.get("source_volume") is None:
                    raise ValueError("MISSING_CANONICAL_INTRADAY_SESSION")
                canonical_days = {day: item for day, item in all_daily.items()
                                  if source_family(item.get("source")) == family
                                  and item.get("quality_status") == "VALID"
                                  and item.get("data_revision") == current_revision
                                  and item.get("source_volume") is not None}
                prior = [item for item in stored if item["trading_date"] < trading_date.isoformat()
                         and item["trading_date"] in canonical_days
                         and item["coverage_status"] == "COMPLETE"
                         and item.get("data_revision") == current_revision
                         and item.get("source") == minute_source][:30]
                start = trading_date if len(prior) >= MIN_BASELINE_SESSIONS else trading_date - timedelta(days=45)
                try:
                    fetched = (_fetch_vci_minutes if family == "VCI" else _fetch_kbs_minutes)(symbol, start, trading_date)
                except SourceUnavailable:
                    if family != "VCI":
                        raise
                    minute_source = "KBS_PUBLIC_1P"
                    prior = []  # Never combine VCI and KBS minute baselines.
                    start = trading_date - timedelta(days=45)
                    fetched = _fetch_kbs_minutes(symbol, start, trading_date)
                daily_volumes = {day: int(item["source_volume"]) for day, item in canonical_days.items()}
                rows = []
                for day, bars in fetched.items():
                    volume = sum(int(bar["v"]) for bar in bars)
                    reference = daily_volumes.get(day)
                    status = "EMPTY" if not bars else "COMPLETE" if reference and abs(volume - reference) / reference <= 0.2 else "PARTIAL"
                    if family == "VCI" and minute_source == "KBS_PUBLIC_1P" and bars:
                        daily_row = canonical_days.get(day) or {}
                        expected = [daily_row.get(key) for key in ("open", "high", "low", "close")]
                        actual = [bars[0]["o"], max(bar["h"] for bar in bars), min(bar["l"] for bar in bars), bars[-1]["c"]]
                        if any(value is None for value in expected) or any(abs(value / 1000 - float(old)) > max(.01, abs(float(old)) * .001) for value, old in zip(actual, expected)):
                            status = "PARTIAL"
                    rows.append({"symbol_id": symbol_id, "trading_date": day, "bars": bars,
                                 "bar_count": len(bars), "minute_volume": volume, "daily_volume": reference,
                                 "coverage_status": status, "data_revision": canonical_days.get(day, {}).get("data_revision"),
                                 "source": minute_source, "collected_at": datetime.now(timezone.utc).isoformat()})
                if rows:
                    db.upsert("intraday_minute_days", rows, "symbol_id,trading_date")
                current = next((item for item in rows if item["trading_date"] == trading_date.isoformat()), None)
                status = current["coverage_status"] if current else "EMPTY"
                symbol_status = status
                counts[status.lower()] += 1
                if status != "COMPLETE":
                    counts["coverage_issues"].append({"symbol": symbol, "status": status})
                if status == "COMPLETE":
                    previous = [item for item in rows if item["trading_date"] < trading_date.isoformat() and item["coverage_status"] == "COMPLETE"
                                and item["trading_date"] in canonical_days]
                    fetched_dates = {item["trading_date"] for item in previous}
                    previous.extend(item for item in prior if item["trading_date"] not in fetched_dates)
                    previous.sort(key=lambda item: item["trading_date"], reverse=True)
                    baseline_count = min(len(previous), 30)
                    if baseline_count < MIN_BASELINE_SESSIONS:
                        symbol_status = "BASELINE_SHORT"
                        counts["coverage_issues"].append({"symbol": symbol, "status": symbol_status,
                                                          "baseline_sessions": baseline_count})
                    def comparable_bars(day: str, minute_bars: list[dict]) -> list[dict]:
                        return [{**bar, "cv": int(bar["v"])} for bar in minute_bars]
                    events = detect_events(
                        symbol_id, trading_date.isoformat(), comparable_bars(trading_date.isoformat(), current["bars"]),
                        [comparable_bars(item["trading_date"], item["bars"]) for item in previous[:30]],
                    )
                    events = [{**event, "source": minute_source} for event in events]
                    response = db._client.delete("/intraday_spike_events", params={"symbol_id": f"eq.{symbol_id}",
                        "trading_date": f"eq.{trading_date.isoformat()}", "algorithm_version": f"eq.{VERSION}"})
                    response.raise_for_status()
                    counts["events"] += db.upsert("intraday_spike_events", events,
                                                   "symbol_id,trading_date,start_time,algorithm_version")
            except Exception as exc:
                symbol_status, error = "FAILED", str(exc)[:160]
                counts["failed"].append({"symbol": symbol, "error": error})
            finally:
                db.upsert("intraday_radar_symbol_status", [{"trading_date": trading_date.isoformat(),
                    "symbol_id": symbol_id, "status": symbol_status, "baseline_sessions": baseline_count,
                    "source": minute_source, "error": error,
                    "updated_at": datetime.now(timezone.utc).isoformat()}], "trading_date,symbol_id")
            if pause_seconds:
                sleep(pause_seconds)
        # Retain event history; prune only compact minute-day records.
        if symbol_offset == 0 and symbols is None:
            response = db._client.delete("/intraday_minute_days", params={"trading_date": f"lt.{cutoff.isoformat()}"})
            response.raise_for_status()
    finally:
        db.close()
    counts["status"] = "FAILED" if counts["failed"] else "PARTIAL" if counts["coverage_issues"] else "SUCCEEDED"
    return counts
