"""Run exactly two independent symbol lots on one authenticated runner."""
import json
import os
from pathlib import Path
import subprocess
import sys


def run_lots(manifest: dict) -> int:
    lots = manifest["include"]
    if not 1 <= len(lots) <= 2:
        raise ValueError("Expected one or two EOD lots")
    names = [set(filter(None, lot["symbols"].split(","))) for lot in lots]
    if len(names) == 2 and names[0] & names[1]:
        raise ValueError("EOD lots must not overlap")
    workers = []
    try:
        for lot in lots:
            print(f"Starting EOD lot {lot['shard']} ({len(set(lot['symbols'].split(',')))} assigned symbols)", flush=True)
            env = {**os.environ, "SYMBOL_MANIFEST": lot["symbols"], "EOD_LOT": str(lot["shard"]), "PYTHONUNBUFFERED": "1"}
            workers.append(subprocess.Popen([sys.executable, str(Path(__file__).with_name("eod_shard.py"))], env=env))
        results = [worker.wait() for worker in workers]
    finally:
        for worker in workers:
            if worker.poll() is None:
                worker.terminate()
                worker.wait()
    print(f"EOD lot exit codes: {results}", flush=True)
    return int(any(results))


if __name__ == "__main__":
    raise SystemExit(run_lots(json.loads(os.environ["SHARD_MATRIX"])))
