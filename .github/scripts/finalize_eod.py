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
if result["status"] != "SUCCEEDED":
    raise SystemExit(f"PARTIAL EOD: {result['covered']}/{result['expected']}; missing: {','.join(result['missing_symbols'])}")
