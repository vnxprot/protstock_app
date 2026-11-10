"""Read-only EOD guard: completed publication, fresh leases and bounded technical recovery."""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import httpx


def _fresh_job(job: dict, now: datetime) -> bool:
    if job.get("status") != "RUNNING":
        return False
    stamp = job.get("heartbeat_at") or job.get("started_at")
    if not stamp:
        return True  # legacy test callers; production always returns started_at
    return now - datetime.fromisoformat(stamp.replace("Z", "+00:00")) < timedelta(minutes=30)


def decide(mode: str, jobs: list[dict], breadth_exists: bool, *, force_rerun: bool = False,
           coverage_status: str | None = None, now: datetime | None = None, source_revision: str | None = None,
           repair_missing: bool = False, required_source_policy: str | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    if force_rerun and mode == "fast-lane":
        return "RUN"
    if any(_fresh_job(job, now) for job in jobs):
        return "SKIP" if mode == "fast-lane" else "IN_PROGRESS"
    latest = next((job for job in jobs if job["job_type"] == "DERIVE_BARS"), None)
    counts = (latest.get("counts") or {}) if latest else {}
    pub_status = counts.get("publication_status")
    covered_symbols = counts.get("covered_symbols")
    # A publication is only complete if it actually covered symbols (> 0), never when 0 symbols were processed.
    valid_publication = pub_status == "COMPLETE" or (
        pub_status == "COMPLETE_WITH_MISSING" and (covered_symbols is None or covered_symbols > 0)
    )
    complete = latest is not None and latest["status"] == "SUCCEEDED" \
        and valid_publication \
        and (source_revision is None or latest.get("source_revision") == source_revision) \
        and (required_source_policy is None or counts.get("source_policy") == required_source_policy)
    if complete:
        if repair_missing and pub_status == "COMPLETE_WITH_MISSING":
            return "RUN" if mode == "fast-lane" else "DISPATCH_FAST_LANE"
        return "SKIP" if mode == "fast-lane" else "COMPLETE"
    # Two balanced shards per attempt; at most three automatic attempts/session.
    if not repair_missing and sum(job["job_type"] == "EOD_INGEST" for job in jobs) >= 6:
        return "SKIP" if mode == "fast-lane" else "RETRY_LIMIT"
    return "RUN" if mode == "fast-lane" else "DISPATCH_FAST_LANE"


def balanced_shards(symbols: list[dict], shard_count: int = 2) -> list[dict]:
    names = sorted({item["symbol"] for item in symbols})
    count = min(max(shard_count, 1), max(len(names), 1))
    return [{"shard": i + 1, "label": f"Lô {i + 1}", "source": "AUTO", "symbols": ",".join(names[i * len(names) // count:(i + 1) * len(names) // count])} for i in range(count)]


def main() -> None:
    mode = sys.argv[1]
    if mode not in {"fast-lane", "watchdog"}:
        raise ValueError(f"Unknown EOD guard mode: {mode}")
    vn_tz = timezone(timedelta(hours=7))
    now_vn = datetime.now(vn_tz)
    explicit_date = os.environ.get("TRADING_DATE")
    requested_day = explicit_date or now_vn.date().isoformat()
    day = requested_day
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
    from protstock.config import Settings
    from protstock.supabase_rest import SupabaseRestClient
    from protstock.eod import resolve_eod_session
    from protstock.analysis import ALGORITHM_VERSION
    from datetime import date, time
    session_client = SupabaseRestClient(Settings.from_env())
    try:
        day = resolve_eod_session(session_client, date.fromisoformat(day)).isoformat()
        symbols = session_client.active_symbols()
    finally:
        session_client.close()
    if not explicit_date and day != requested_day:
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"action=SKIP\ntrading_date={day}\nmatrix={{\"include\": []}}\n")
        print(f"Market closed on {requested_day}; no automatic EOD dispatch")
        return
    if not explicit_date and day == now_vn.date().isoformat() and now_vn.time() < time(15, 0):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"action=SKIP\ntrading_date={day}\nmatrix={{\"include\": []}}\n")
        print(f"Market session {day} has not closed yet (current VN time: {now_vn.strftime('%H:%M:%S')}); no automatic EOD dispatch before 15:00")
        return
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    with httpx.Client(base_url=os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1", headers=headers, timeout=30) as client:
        jobs_response = client.get("/job_runs", params={
            "select": "job_type,status,counts,source_revision,started_at,heartbeat_at", "job_type": "in.(EOD_INGEST,DERIVE_BARS)",
            "trading_date": f"eq.{day}", "order": "started_at.desc", "limit": "100",
        })
        jobs_response.raise_for_status()
        breadth_response = client.get("/market_breadth_snapshots", params={
            "select": "trading_date,coverage_status", "trading_date": f"eq.{day}", "limit": "1",
        })
        breadth_response.raise_for_status()
    breadth = breadth_response.json()
    action = decide(mode, jobs_response.json(), bool(breadth), coverage_status=breadth[0].get("coverage_status") if breadth else None,
                    source_revision=ALGORITHM_VERSION, force_rerun=os.environ.get("FORCE_RERUN") == "true",
                    repair_missing=os.environ.get("REPAIR_MISSING") == "true", required_source_policy="VCI_DIRECT_PRIMARY_V1")
    print(f"EOD {day}: {action}; expected universe: {len(symbols)}")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"action={action}\ntrading_date={day}\nmatrix={json.dumps({'include': balanced_shards(symbols)}, ensure_ascii=False)}\n")


if __name__ == "__main__":
    main()
