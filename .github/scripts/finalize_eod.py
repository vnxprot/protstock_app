import json
import os
from datetime import date
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from protstock.eod import finalize_fast_lane

result = finalize_fast_lane(date.fromisoformat(os.environ["TRADING_DATE"]), allow_partial=True,
                           prepared_dir=Path(os.environ["RUNNER_TEMP"]) / "analysis")
print(json.dumps(result, ensure_ascii=False))
with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a", encoding="utf-8") as output:
    output.write(f"trading_date={os.environ['TRADING_DATE']}\n")
if result["status"] != "SUCCEEDED":
    raise SystemExit("EOD publication failed; check technical job errors")
if result.get("missing_symbols"):
    print(f"EOD complete; no candle returned for: {','.join(result['missing_symbols'])}. No automatic retry.", flush=True)
