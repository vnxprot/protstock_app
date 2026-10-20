"""Bounded same-run recovery; keep successful calculations for final publication."""
import json
import os
from datetime import date
from pathlib import Path
import sys
from time import sleep

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from protstock.config import Settings
from protstock.eod import run_eod
from protstock.supabase_rest import SupabaseRestClient


def main():
    names = set(filter(None, os.environ["SYMBOL_MANIFEST"].split(",")))
    day = date.fromisoformat(os.environ["TRADING_DATE"])
    directory = Path(os.environ["RUNNER_TEMP"]) / "analysis"
    result = None
    permanent = set()
    for attempt in range(2):
        if not names:
            break
        result = run_eod(day, source="AUTO", fast_lane=True, write_breadth_snapshot=False,
            symbol_names=names, prepared_dir=directory,
            missing_only=attempt == 0 and os.getenv("FORCE_RERUN") != "true")
        print(json.dumps(result, ensure_ascii=False))
        client = SupabaseRestClient(Settings.from_env())
        try:
            items = client._pages("job_run_items", {"select": "item_key,status,error_message,warning_codes",
                "job_run_id": f"eq.{result['job_id']}"})
        finally:
            client.close()
        retry = set()
        for item in items:
            if item["status"] == "FAILED":
                message = (item.get("error_message") or "").lower()
                if any(word in message for word in ("timeout", "timed out", "429", "rate limit", "network", "503", "502", "connection")):
                    retry.add(item["item_key"])
                else:
                    permanent.add(item["item_key"])
        names = retry
        if names and attempt == 0:
            print(f"Retrying {len(names)} transient technical failures once in the same run")
            sleep(65)
    if permanent or (result and result.get("failed")):
        raise SystemExit(f"EOD shard incomplete; permanent errors: {','.join(sorted(permanent))}; check job_run_items")


if __name__ == "__main__":
    main()
