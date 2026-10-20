"""Probe the public vendor contracts without an SDK/account prerequisite."""
from datetime import date, timedelta
import json
import os
from pathlib import Path
import sys

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from protstock.config import vietnam_today
from protstock.provider_market import MarketDataProvider
from protstock.market_sources import directory
from protstock.market_http import SourceUnavailable


def main():
    day = date.fromisoformat(os.environ["TRADING_DATE"]) if os.getenv("TRADING_DATE") else vietnam_today() - timedelta(days=1)
    state = {"status": "HEALTHY", "policy": "VCI_DIRECT_PRIMARY_V1", "samples": []}
    try:
        for symbol in ("VNINDEX", "FPT", "BIC"):
            bars = MarketDataProvider("AUTO").history(symbol, day - timedelta(days=14), day)
            if not bars or (day - bars[-1].trading_date).days > 7:
                raise RuntimeError(f"{symbol}: public price source is empty/stale")
            state["samples"].append({"symbol": symbol, "source": bars[-1].source})
            if not bars[-1].source.startswith("VCI_"):
                state["status"] = "DEGRADED_KBS_FALLBACK"
        try:
            directory("VCI")
        except SourceUnavailable:
            directory("KBS")
            state["status"] = "DEGRADED_KBS_FALLBACK"
    except Exception as error:
        state.update(status="FAILED", error=str(error)[:300])
    print(json.dumps(state, ensure_ascii=False), flush=True)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            output.write("Public market source health\n```json\n" + json.dumps(state, ensure_ascii=False, indent=2) + "\n```\n")
    if "--notify" in sys.argv:
        token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
        url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        previous = None
        if url and key:
            headers = {"apikey": key, "Authorization": f"Bearer {key}"}
            object_path = "database-archives/runtime/direct-market-health.json"
            response = httpx.get(f"{url}/storage/v1/object/authenticated/{object_path}", headers=headers, timeout=30)
            if response.status_code == 200:
                previous = response.json()
            response = httpx.post(f"{url}/storage/v1/object/{object_path}", headers={**headers, "x-upsert": "true"}, json=state, timeout=30)
            response.raise_for_status()
        if token and chat and previous != state:
            response = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat,
                "text": "Prot Stock · public market source health\n" + json.dumps(state, ensure_ascii=False)}, timeout=30)
            if response.status_code != 200 or not response.json().get("ok"):
                raise RuntimeError("Source-health Telegram notification failed")
    if state["status"] == "FAILED":
        raise SystemExit("Both public vendor paths failed the data contract")


if __name__ == "__main__":
    main()
