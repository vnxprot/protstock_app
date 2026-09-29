"""Read-only guard shared by scheduled Fast Lane and the single EOD watchdog."""

import os
import sys
from datetime import date

import httpx


def decide(mode: str, jobs: list[dict], breadth_exists: bool, *, force_rerun: bool = False) -> str:
    published = breadth_exists and any(
        job["job_type"] == "EOD_INGEST" and job["status"] in {"SUCCEEDED", "PARTIAL"}
        for job in jobs
    ) and any(
        job["job_type"] == "DERIVE_BARS" and job["status"] == "SUCCEEDED"
        for job in jobs
    )
    if mode == "fast-lane":
        return "RUN" if force_rerun or not published else "SKIP"
    if published:
        return "COMPLETE"
    if any(job["status"] == "RUNNING" for job in jobs):
        return "IN_PROGRESS"
    return "DISPATCH_FAST_LANE"


def main() -> None:
    mode = sys.argv[1]
    if mode not in {"fast-lane", "watchdog"}:
        raise ValueError(f"Unknown EOD guard mode: {mode}")
    day = os.environ.get("TRADING_DATE") or date.today().isoformat()
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    with httpx.Client(base_url=os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1", headers=headers, timeout=30) as client:
        jobs_response = client.get("/job_runs", params={
            "select": "job_type,status", "job_type": "in.(EOD_INGEST,DERIVE_BARS)",
            "trading_date": f"eq.{day}", "order": "started_at.desc", "limit": "100",
        })
        jobs_response.raise_for_status()
        breadth_response = client.get("/market_breadth_snapshots", params={
            "select": "trading_date", "trading_date": f"eq.{day}", "limit": "1",
        })
        breadth_response.raise_for_status()
    action = decide(mode, jobs_response.json(), bool(breadth_response.json()), force_rerun=os.environ.get("FORCE_RERUN") == "true")
    print(f"EOD {day}: {action}")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"action={action}\n")


if __name__ == "__main__":
    main()
