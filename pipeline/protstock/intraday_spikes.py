"""End-of-day, minute-bar volume anomaly research for the active universe."""
from __future__ import annotations

from collections import defaultdict
from base64 import b64decode, b64encode
from datetime import date, datetime, timedelta, timezone
import gzip
import json
from statistics import median
from time import sleep

import httpx

from .config import Settings
from .price_basis import canonical_price_rows, source_family
from .provider_market import MarketDataProvider
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


def pack_minute_bars(bars: list[dict]) -> list[dict] | dict:
    if not bars:
        return bars
    raw = json.dumps(bars, separators=(",", ":"), allow_nan=False).encode()
    encoded = b64encode(gzip.compress(raw, mtime=0)).decode("ascii")
    return {"gzip_v1": encoded} if len(encoded) + 32 < len(raw) else bars


def unpack_minute_bars(value: list[dict] | dict) -> list[dict]:
    if isinstance(value, list):
        return value
    bars = json.loads(gzip.decompress(b64decode(value["gzip_v1"], validate=True)))
    if not isinstance(bars, list):
        raise ValueError("Invalid minute-day archive")
    return bars


def retryable_failure(error: Exception) -> bool:
    """Retry transport/rate/server failures, never schema or baseline errors."""
    if isinstance(error, (httpx.TimeoutException, httpx.NetworkError)):
        return True
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in {408, 429, 500, 502, 503, 504}
    if isinstance(error, SourceUnavailable):
        return any(f"HTTP={code}" in str(error) for code in (408, 429, 500, 502, 503, 504)) or "HTTP=None" in str(error)
    return False


def _minute_of_day(time_text: str) -> int:
    hour, minute = (int(part) for part in time_text.split(":"))
    return hour * 60 + minute


def _session(time_text: str, exchange: str = "") -> int | None:
    minute = _minute_of_day(time_text)
    if 9 * 60 <= minute <= 11 * 60 + 30:
        return 1
    close = 15 * 60 if exchange == "UPCOM" else 14 * 60 + 45
    if 13 * 60 <= minute <= close:
        return 2
    return None


def parse_minute_bars(payload: dict, symbol: str, start: date, end: date, exchange: str = "") -> dict[str, list[dict]]:
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
            if not start <= parsed_day <= end or _session(minute, exchange) is None:
                continue
            o, h, l, c = (float(record[key]) for key in ("o", "h", "l", "c"))
            volume = int(float(record.get("v") or 0))
        except (ValueError, TypeError, KeyError):
            continue
        if min(o, h, l, c) <= 0 or volume < 0 or h < max(o, c) or l > min(o, c):
            continue
        days[day][minute] = {"t": minute, "o": o, "h": h, "l": l, "c": c, "v": volume}
    return {day: sorted(by_time.values(), key=lambda bar: bar["t"]) for day, by_time in days.items()}


def _window(day_map: dict[int, dict], start: int, length: int, exchange: str = "") -> list[dict] | None:
    start_time = f"{start // 60:02d}:{start % 60:02d}"
    end = start + length - 1
    end_time = f"{end // 60:02d}:{end % 60:02d}"
    session = _session(start_time, exchange)
    if session is None or _session(end_time, exchange) != session:
        return None
    # No recorded match in a minute means zero volume within a complete day.
    return [day_map[minute] for minute in range(start, end + 1) if minute in day_map]


def detect_events(symbol_id: int, trading_date: str, bars: list[dict], history: list[list[dict]],
                  exchange: str = "") -> list[dict]:
    """Compare rolling windows with matching clock minutes on prior complete days."""
    today = {_minute_of_day(bar["t"]): bar for bar in bars}
    historical = [{_minute_of_day(bar["t"]): bar for bar in day} for day in history]
    if len(historical) < MIN_BASELINE_SESSIONS:
        return []
    candidates: list[dict] = []
    for start in sorted(today):
        for length in WINDOWS:
            window = _window(today, start, length, exchange)
            if not window:
                continue
            volume = sum(int(bar.get("cv", bar["v"])) for bar in window)
            value = sum(float(bar["c"]) * int(bar["v"]) for bar in window)
            if value < MIN_VALUE_VND:
                continue
            baseline = []
            for earlier in historical:
                comparable = _window(earlier, start, length, exchange)
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


def _fetch_vci_minutes(symbol: str, start: date, end: date, exchange: str = "") -> dict[str, list[dict]]:
    """Read public VCI candles directly; the raw endpoint uses VND/share."""
    return parse_minute_bars({"data": vci_candles(symbol, start, end, minute=True)}, symbol, start, end, exchange)


def _fetch_kbs_minutes(symbol: str, start: date, end: date, exchange: str = "") -> dict[str, list[dict]]:
    """Use KBS minutes only when the selected EOD series is also KBS."""
    payload = request_json("GET",
        f"https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/{symbol}/data_1P",
        params={"sdate": start.strftime("%d-%m-%Y"), "edate": (end + timedelta(days=1)).strftime("%d-%m-%Y")},
    )
    return parse_minute_bars(payload, symbol, start, end, exchange)


def _vci_baseline_references(symbol_id: int, symbol: str, start: date, end: date,
                             revision: str) -> dict[str, dict]:
    """Use the daily endpoint of the minute vendor without rewriting canonical EOD."""
    bars = MarketDataProvider("VCI").history(symbol, start, end)
    rows = canonical_price_rows(symbol_id, bars, (), as_of_date=end)
    return {row["trading_date"]: row for row in rows if row["data_revision"] == revision}


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
            exchange = str(row.get("exchange") or "").upper()
            session_close = "15:00" if exchange == "UPCOM" else "14:45"
            symbol_status, baseline_count, minute_source, error = "EMPTY", 0, None, None
            retryable = False
            current = None
            events = []
            try:
                stored = db._pages("intraday_minute_days", {
                    "select": "trading_date,bars,coverage_status,data_revision,source,reference_source,session_close",
                    "symbol_id": f"eq.{symbol_id}", "and": f"(trading_date.gte.{cutoff},trading_date.lte.{trading_date})",
                    "order": "trading_date.desc"}, limit=65)
                daily = db._get("/daily_prices", params=[("select", "trading_date,open,high,low,close,source,source_volume,quality_status,data_revision"),
                    ("symbol_id", f"eq.{symbol_id}"), ("trading_date", f"gte.{cutoff.isoformat()}"),
                    ("trading_date", f"lte.{trading_date.isoformat()}"), ("limit", "65")])
                daily.raise_for_status()
                all_daily = {item["trading_date"]: item for item in daily.json()}
                current_daily = all_daily.get(trading_date.isoformat())
                if current_daily is None:
                    error = "EOD_MISSING_CANDLE"
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
                         and (item["trading_date"] in canonical_days
                              or (minute_source == SOURCE and item.get("reference_source") == "VCI_DIRECT"))
                         and item["coverage_status"] == "COMPLETE"
                         and item.get("data_revision") == current_revision
                         and item.get("source") == minute_source
                         and (exchange != "UPCOM" or item.get("session_close") == session_close)][:30]
                start = trading_date if len(prior) >= MIN_BASELINE_SESSIONS else trading_date - timedelta(days=45)
                try:
                    fetched = (_fetch_vci_minutes if family == "VCI" else _fetch_kbs_minutes)(symbol, start, trading_date, exchange)
                except SourceUnavailable:
                    if family != "VCI":
                        raise
                    minute_source = "KBS_PUBLIC_1P"
                    prior = []  # Never combine VCI and KBS minute baselines.
                    start = trading_date - timedelta(days=45)
                    fetched = _fetch_kbs_minutes(symbol, start, trading_date, exchange)
                references = dict(canonical_days)
                missing_refs = [day for day in fetched if day < trading_date.isoformat() and day not in references]
                if minute_source == SOURCE and missing_refs:
                    alternative = _vci_baseline_references(symbol_id, symbol, date.fromisoformat(min(missing_refs)),
                                                           date.fromisoformat(max(missing_refs)), current_revision)
                    references.update({day: alternative[day] for day in missing_refs if day in alternative})
                rows = []
                for day, bars in fetched.items():
                    daily_row = references.get(day)
                    if not daily_row:
                        continue
                    volume = sum(int(bar["v"]) for bar in bars)
                    reference = int(daily_row["source_volume"])
                    tolerance = 0.2 if day in canonical_days else 0
                    status = "EMPTY" if not bars else "COMPLETE" if reference and abs(volume - reference) / reference <= tolerance else "PARTIAL"
                    if family == "VCI" and minute_source == "KBS_PUBLIC_1P" and bars:
                        expected = [daily_row.get(key) for key in ("open", "high", "low", "close")]
                        actual = [bars[0]["o"], max(bar["h"] for bar in bars), min(bar["l"] for bar in bars), bars[-1]["c"]]
                        if any(value is None for value in expected) or any(abs(value / 1000 - float(old)) > max(.01, abs(float(old)) * .001) for value, old in zip(actual, expected)):
                            status = "PARTIAL"
                    rows.append({"symbol_id": symbol_id, "trading_date": day, "bars": bars,
                                 "bar_count": len(bars), "minute_volume": volume, "daily_volume": reference,
                                 "coverage_status": status, "data_revision": daily_row["data_revision"],
                                 "reference_source": daily_row["source"], "session_close": session_close,
                                 "source": minute_source, "collected_at": datetime.now(timezone.utc).isoformat()})
                current = next((item for item in rows if item["trading_date"] == trading_date.isoformat()), None)
                history_rows = [item for item in rows if item is not current]
                good_stored = {item["trading_date"] for item in stored if item["coverage_status"] == "COMPLETE"}
                history_updates = [item for item in history_rows
                                   if item["trading_date"] not in good_stored or
                                   (item["coverage_status"] == "COMPLETE" and (family != "VCI" or minute_source == SOURCE))]
                if history_updates:
                    db.upsert("intraday_minute_days", [{**item, "bars": pack_minute_bars(item["bars"])}
                              for item in history_updates], "symbol_id,trading_date")
                status = current["coverage_status"] if current else "EMPTY"
                symbol_status = status
                counts[status.lower()] += 1
                if status != "COMPLETE":
                    counts["coverage_issues"].append({"symbol": symbol, "status": status})
                if status == "COMPLETE":
                    previous = [item for item in history_rows if item["coverage_status"] == "COMPLETE"]
                    fetched_dates = {item["trading_date"] for item in previous}
                    previous.extend(item for item in prior if item["trading_date"] not in fetched_dates)
                    previous.sort(key=lambda item: item["trading_date"], reverse=True)
                    baseline_count = min(len(previous), 30)
                    if baseline_count < MIN_BASELINE_SESSIONS:
                        symbol_status = "BASELINE_SHORT"
                        counts["coverage_issues"].append({"symbol": symbol, "status": symbol_status,
                                                          "baseline_sessions": baseline_count})
                    events = detect_events(
                        symbol_id, trading_date.isoformat(), current["bars"],
                        [unpack_minute_bars(item["bars"]) for item in previous[:30]], exchange,
                    )
                    events = [{**event, "source": minute_source} for event in events]
            except Exception as exc:
                symbol_status, error = "FAILED", str(exc)[:160]
                retryable = retryable_failure(exc)
                counts["failed"].append({"symbol": symbol, "error": error})
            finally:
                response = db._client.post("/rpc/save_intraday_spike_result", json={
                    "p_day": trading_date.isoformat(), "p_symbol_id": symbol_id, "p_version": VERSION,
                    "p_status": symbol_status, "p_baseline": baseline_count, "p_source": minute_source,
                    "p_error": error, "p_retryable": retryable,
                    "p_minute_day": {**current, "bars": pack_minute_bars(current["bars"])} if current else None,
                    "p_events": events})
                response.raise_for_status()
                if symbol_status == "COMPLETE":
                    counts["events"] += len(events)
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
