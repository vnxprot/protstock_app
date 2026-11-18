"""Run exactly two independent symbol lots on one authenticated runner."""
import json
import os
from datetime import date, datetime
from pathlib import Path
import subprocess
import sys

from protstock.config import Settings
from protstock.eod import HISTORY_START, _history_limit
from protstock.market_sources import VN
from protstock.price_basis import source_family, source_version
from protstock.provider_market import INDEX_PRICE_UNIT, MarketDataProvider
from protstock.ssi_market_data import configured
from protstock.ssi_price_rollout import archive_price_window, rollout_symbols, verify_price_window
from protstock.ssi_universe_history import cutover_history
from protstock.supabase_rest import SupabaseRestClient


def prepare_ssi_rollout():
    day = date.fromisoformat(os.environ["TRADING_DATE"])
    limit = int(os.getenv("SSI_PRICE_BATCH") or 12)
    if not configured() or not 1 <= limit <= 30 or day != datetime.now(VN).date():
        return
    db = SupabaseRestClient(Settings.from_env())
    try:
        symbols = rollout_symbols(db, day, limit)
        if not symbols:
            return
        index = db.market_index("VNINDEX")
        stored = db.index_price_history(index["id"], _history_limit(day))
        window = [row for row in stored if HISTORY_START.isoformat() <= row["trading_date"] <= day.isoformat()]
        if window and source_family(window[-1]["source"]) != "SSI":
            try:
                bars = cutover_history(db, MarketDataProvider("SSI"), "VNINDEX", day)
                if not bars or bars[-1].trading_date != day:
                    raise ValueError("SSI VNINDEX is missing the current session")
                verify_price_window(window, bars)
                archive_price_window(db, "market_index_prices", index["id"], window)
                db.upsert("market_index_prices", [{
                    "index_id": index["id"], "trading_date": bar.trading_date.isoformat(),
                    "open": float(bar.open), "high": float(bar.high), "low": float(bar.low), "close": float(bar.close),
                    "volume": bar.volume, "source": bar.source, "price_unit": INDEX_PRICE_UNIT,
                    "source_version": source_version(bar.source), "collected_at": bar.collected_at.isoformat(),
                } for bar in bars], "index_id,trading_date")
            except Exception as error:
                print(f"::notice::SSI VNINDEX cutover deferred: {type(error).__name__}: {error}", flush=True)
        os.environ["SSI_PRICE_CANDIDATES"] = ",".join(symbols)
    except Exception as error:
        print(f"::notice::SSI price rollout deferred: {type(error).__name__}: {error}", flush=True)
    finally:
        db.close()


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
    if os.getenv("PROTSTOCK_PRICE_CUTOVER") != "true":
        prepare_ssi_rollout()
    raise SystemExit(run_lots(json.loads(os.environ["SHARD_MATRIX"])))
