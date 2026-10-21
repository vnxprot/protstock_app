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
MAX_ATTEMPTS = 3


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
    if same_policy and previous.get("status") == "PUBLISHED" and not force_refresh:
        write_output(action="DONE", trading_date=day, matrix={"include": []})
        return
    symbols = client.active_symbols()
    snapshot_ids = {int(row["symbol_id"]) for row in client.daily_snapshots_for_date(datetime.fromisoformat(day).date())}
    price_ids = client.daily_price_symbol_ids(datetime.fromisoformat(day).date())
    eligible = [row for row in symbols if int(row["id"]) in snapshot_ids & price_ids]
    missing = [row for row in symbols if int(row["id"]) not in snapshot_ids & price_ids]
    states = read(client, "intraday_radar_symbol_status", {"select": "symbol_id,status,baseline_sessions,retryable,error",
        "trading_date": f"eq.{day}", "limit": "1000"})
    by_id = {int(row["symbol_id"]): row for row in states}
    pending_rows = [row for row in eligible if force_refresh or not same_policy
                    or int(row["id"]) not in by_id or by_id[int(row["id"])].get("retryable")
                    or by_id[int(row["id"])].get("error") == "EOD_MISSING_CANDLE"]
    baseline_ready = sum(by_id.get(int(row["id"]), {}).get("status") == "COMPLETE"
                         and by_id.get(int(row["id"]), {}).get("baseline_sessions", 0) >= 10 for row in eligible)
    if previous and not force_refresh and same_policy and not pending_rows and eligible and baseline_ready / len(eligible) < THRESHOLD:
        write_output(action="NEEDS_ATTENTION", trading_date=day, matrix={"include": []})
        raise RuntimeError(f"Radar {day}: source coverage/baseline insufficient; no technical retry available")
    # Attempt claims are transactional but not replayable after an ambiguous network timeout.
    response = client._client.post("/rpc/begin_intraday_radar_session", json={
        "p_day": day, "p_policy": SOURCE_POLICY, "p_eligible": eligible, "p_missing": missing,
        "p_pending": [int(row["id"]) for row in pending_rows], "p_force": force_refresh})
    if response.is_error:
        try:
            body = response.json()
            print({key: body[key] for key in ("code", "message", "details", "hint") if key in body}, flush=True)
        except (ValueError, TypeError):
            pass
    response.raise_for_status()
    claim = response.json()
    if claim["action"] != "RUN":
        write_output(action=claim["action"], trading_date=day, matrix={"include": []})
        if claim["action"] == "RETRY_LIMIT":
            raise RuntimeError(f"Radar {day}: exhausted {MAX_ATTEMPTS} technical attempts; intervention required")
        return
    attempt = claim["attempt"]
    if not eligible:
        client.upsert("intraday_radar_sessions", [{"trading_date": day, "status": "INCOMPLETE",
            "source_errors": [{"symbol": "SESSION", "error": "NO_ELIGIBLE_EOD_SYMBOLS"}],
            "updated_at": datetime.now(timezone.utc).isoformat()}], "trading_date")
        write_output(action="NEEDS_ATTENTION", trading_date=day, matrix={"include": []})
        raise RuntimeError(f"Radar {day}: no eligible EOD symbols; refusing to publish an empty universe")
    pending = [row["symbol"] for row in pending_rows]
    if not pending:
        write_output(action="FINALIZE_ONLY", trading_date=day, attempt=attempt, matrix={"include": []})
        return
    shards = [{"shard": i + 1, "symbols": ",".join(pending[i::2])} for i in range(2) if pending[i::2]]
    write_output(action="RUN", trading_date=day, attempt=attempt, matrix={"include": shards})
    print(f"Radar {day}: attempt {attempt}, {len(pending)} symbols pending")


def finalize(client, day):
    sessions = read(client, "intraday_radar_sessions", {"select": "expected_symbols,attempt_count", "trading_date": f"eq.{day}", "limit": "1"})
    if not sessions:
        raise RuntimeError(f"Radar session {day} does not exist")
    all_states = read(client, "intraday_radar_symbol_status", {"select": "symbol_id,status,baseline_sessions,error,retryable",
        "trading_date": f"eq.{day}", "limit": "1000"})
    states = [row for row in all_states if row.get("error") != "EOD_MISSING_CANDLE"]
    complete = sum(row["status"] in {"COMPLETE", "BASELINE_SHORT"} for row in states)
    baseline = sum(row["baseline_sessions"] >= 10 and row["status"] == "COMPLETE" for row in states)
    expected = sessions[0]["expected_symbols"]
    published = expected > 0 and baseline / expected >= THRESHOLD
    technical = any(row.get("retryable") for row in states)
    names = {int(row["id"]): row["symbol"] for row in client.active_symbols()}
    errors = [{"symbol": names.get(int(row["symbol_id"]), str(row["symbol_id"])),
               "status": row["status"], "error": row.get("error")}
              for row in all_states if row["status"] != "COMPLETE"][:30]
    payload = {"trading_date": day, "status": "PUBLISHED" if published else "FAILED" if technical else "INCOMPLETE",
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
    if not published:
        raise RuntimeError(f"Radar {day}: {payload['status']}; ready {baseline}/{expected}; "
                           f"attempt {sessions[0]['attempt_count']}/{MAX_ATTEMPTS}. "
                           + ("Watchdog will retry technical failures." if technical and sessions[0]['attempt_count'] < MAX_ATTEMPTS
                              else "Manual attention required; source gaps are not retried automatically."))


def watchdog(client, day):
    jobs = read(client, "job_runs", {"select": "status,counts,finished_at", "job_type": "eq.DERIVE_BARS",
        "trading_date": f"eq.{day}", "order": "started_at.desc", "limit": "1"})
    latest = jobs[0] if jobs else {}
    if not (latest.get("status") == "SUCCEEDED" and latest.get("finished_at")
            and (latest.get("counts") or {}).get("publication_status") in {"COMPLETE", "COMPLETE_WITH_MISSING", "PARTIAL"}):
        write_output(action="WAIT_EOD", trading_date=day)
        return
    sessions = read(client, "intraday_radar_sessions", {"select": "status,attempt_count,expected_symbols,updated_at",
        "trading_date": f"eq.{day}", "limit": "1"})
    session = sessions[0] if sessions else {}
    if session.get("status") == "PUBLISHED":
        write_output(action="DONE", trading_date=day)
        return
    updated = session.get("updated_at")
    if session.get("status") == "PROCESSING" and updated and datetime.now(timezone.utc) - datetime.fromisoformat(updated.replace("Z", "+00:00")) < timedelta(hours=4):
        write_output(action="IN_PROGRESS", trading_date=day)
        return
    if session.get("attempt_count", 0) >= MAX_ATTEMPTS:
        raise RuntimeError(f"Radar {day}: not published after {MAX_ATTEMPTS} attempts; manual attention required")
    states = read(client, "intraday_radar_symbol_status", {"select": "symbol_id,status,baseline_sessions,retryable,error",
        "trading_date": f"eq.{day}", "limit": "1000"}) if session else []
    expected = session.get("expected_symbols", 0)
    baseline_ready = sum(row.get("status") == "COMPLETE" and row.get("baseline_sessions", 0) >= 10
                         and row.get("error") != "EOD_MISSING_CANDLE" for row in states)
    finalize_ready = expected > 0 and baseline_ready / expected >= THRESHOLD
    if session and states and not finalize_ready and not any(row.get("retryable") for row in states):
        raise RuntimeError(f"Radar {day}: insufficient source coverage/baseline; automatic retry suppressed")
    write_output(action="DISPATCH_RADAR", trading_date=day)
    print(f"Radar {day}: recover missing/failed session independently of EOD")


if __name__ == "__main__":
    mode = sys.argv[1]
    day = os.environ.get("TRADING_DATE") or datetime.now(timezone(timedelta(hours=7))).date().isoformat()
    db = SupabaseRestClient(Settings.from_env())
    try:
        if mode == "preflight":
            preflight(db, day)
        elif mode == "finalize":
            finalize(db, day)
        elif mode == "watchdog":
            watchdog(db, day)
        else:
            raise ValueError(mode)
    finally:
        db.close()
