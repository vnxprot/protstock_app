"""Start bounded Radar collection only after the EOD publication is complete."""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from protstock.config import Settings
from protstock.supabase_rest import SupabaseRestClient

THRESHOLD = 0.95
SOURCE_POLICY = "VCI_DIRECT_MINUTES_ONCE_V1"


def read(client, table, params):
    response = client._get(f"/{table}", params=params)
    response.raise_for_status()
    return response.json()


def write_output(**values):
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={json.dumps(value, separators=(',', ':')) if isinstance(value, (dict, list)) else value}\n")


def preflight(client, day):
    jobs = read(client, "job_runs", {"select": "status,counts,finished_at", "job_type": "eq.DERIVE_BARS",
        "trading_date": f"eq.{day}", "order": "started_at.desc", "limit": "1"})
    latest = jobs[0] if jobs else {}
    counts = latest.get("counts") or {}
    expected = int(counts.get("expected_symbols") or 0)
    covered = int(counts.get("covered_symbols") or 0)
    eod_ready = (latest.get("status") == "SUCCEEDED" and latest.get("finished_at")
                 and counts.get("publication_status") in {"COMPLETE", "COMPLETE_WITH_MISSING", "PARTIAL"})
    if not eod_ready:
        write_output(action="WAIT_EOD", trading_date=day, matrix={"include": []})
        return
    session = read(client, "intraday_radar_sessions", {"select": "status,attempt_count,source_policy,updated_at", "trading_date": f"eq.{day}", "limit": "1"})
    previous = session[0] if session else {}
    force_refresh = os.getenv("FORCE_REFRESH") == "true"
    same_policy = previous.get("source_policy") == SOURCE_POLICY
    updated = previous.get("updated_at")
    fresh = bool(updated and datetime.now(timezone.utc) - datetime.fromisoformat(updated.replace("Z", "+00:00")) < timedelta(hours=4))
    if previous.get("status") == "PROCESSING" and fresh:
        write_output(action="IN_PROGRESS", trading_date=day, matrix={"include": []})
        return
    if same_policy and previous.get("status") in {"PUBLISHED", "INCOMPLETE"} and not force_refresh:
        write_output(action="DONE", trading_date=day, matrix={"include": []})
        return
    symbols = client.active_symbols()
    snapshot_ids = {int(row["symbol_id"]) for row in client.daily_snapshots_for_date(datetime.fromisoformat(day).date())}
    price_ids = client.daily_price_symbol_ids(datetime.fromisoformat(day).date())
    eligible = [row for row in symbols if int(row["id"]) in snapshot_ids & price_ids]
    missing = [row for row in symbols if int(row["id"]) not in snapshot_ids & price_ids]
    if missing:
        client.upsert("intraday_radar_symbol_status", [{"trading_date": day, "symbol_id": row["id"],
            "status": "EMPTY", "baseline_sessions": 0, "source": None, "error": "EOD_MISSING_CANDLE",
            "updated_at": datetime.now(timezone.utc).isoformat()} for row in missing], "trading_date,symbol_id")
    pending = [row["symbol"] for row in eligible]
    attempt = previous.get("attempt_count", 0) + 1
    client.upsert("intraday_radar_sessions", [{"trading_date": day, "status": "PROCESSING",
        "source_policy": SOURCE_POLICY, "attempt_count": attempt, "expected_symbols": len(eligible), "coverage_threshold": THRESHOLD,
        "updated_at": datetime.now(timezone.utc).isoformat()}], "trading_date")
    if not pending:
        client.upsert("intraday_radar_sessions", [{"trading_date": day,"status": "PUBLISHED",
            "source_policy": SOURCE_POLICY,"expected_symbols": 0,"complete_symbols": 0,"baseline_ready_symbols": 0,
            "published_at": datetime.now(timezone.utc).isoformat(),"updated_at": datetime.now(timezone.utc).isoformat()}], "trading_date")
        write_output(action="DONE", trading_date=day, matrix={"include": []})
        return
    shards = [{"shard": i + 1, "symbols": ",".join(pending[i::2])} for i in range(2) if pending[i::2]]
    write_output(action="RUN", trading_date=day, attempt=attempt, matrix={"include": shards})
    print(f"Radar {day}: attempt {attempt}, {len(pending)} symbols pending")


def finalize(client, day):
    sessions = read(client, "intraday_radar_sessions", {"select": "expected_symbols,attempt_count", "trading_date": f"eq.{day}", "limit": "1"})
    if not sessions:
        raise RuntimeError(f"Radar session {day} does not exist")
    states = read(client, "intraday_radar_symbol_status", {"select": "symbol_id,status,baseline_sessions,error",
        "trading_date": f"eq.{day}", "limit": "1000"})
    states = [row for row in states if row.get("error") != "EOD_MISSING_CANDLE"]
    complete = sum(row["status"] in {"COMPLETE", "BASELINE_SHORT"} for row in states)
    baseline = sum(row["baseline_sessions"] >= 10 and row["status"] == "COMPLETE" for row in states)
    expected = sessions[0]["expected_symbols"]
    published = expected == 0 or baseline / expected >= THRESHOLD
    names = {int(row["id"]): row["symbol"] for row in client.active_symbols()}
    errors = [{"symbol": names.get(int(row["symbol_id"]), str(row["symbol_id"])),
               "status": row["status"], "error": row.get("error")}
              for row in states if row["status"] != "COMPLETE"][:30]
    payload = {"trading_date": day, "status": "PUBLISHED" if published else "INCOMPLETE",
        "complete_symbols": complete, "baseline_ready_symbols": baseline, "source_errors": errors,
        "updated_at": datetime.now(timezone.utc).isoformat()}
    if published:
        payload["published_at"] = datetime.now(timezone.utc).isoformat()
    client.upsert("intraday_radar_sessions", [payload], "trading_date")
    # Matrix collectors never execute the old whole-universe pruning branch.
    # Reclaim only minute-day cache outside the documented 50-day retention.
    cutoff = (datetime.fromisoformat(day) - timedelta(days=50)).date().isoformat()
    response = client._client.delete("/intraday_minute_days", params={"trading_date": f"lt.{cutoff}"})
    response.raise_for_status()
    print(f"Radar {day}: {payload['status']}; ready {baseline}/{expected}; attempt {sessions[0]['attempt_count']}")


if __name__ == "__main__":
    mode = sys.argv[1]
    day = os.environ.get("TRADING_DATE") or datetime.now(timezone(timedelta(hours=7))).date().isoformat()
    db = SupabaseRestClient(Settings.from_env())
    try:
        if mode == "preflight":
            preflight(db, day)
        elif mode == "finalize":
            finalize(db, day)
        else:
            raise ValueError(mode)
    finally:
        db.close()
