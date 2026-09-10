from __future__ import annotations

import os
from datetime import date

import httpx

from .config import Settings
from .supabase_rest import SupabaseRestClient


def send_eod_telegram_alerts(trading_date: date) -> dict:
    token, chat_id = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return {"status": "DISABLED", "reason": "Telegram secrets are not configured"}
    client = SupabaseRestClient(Settings.from_env())
    try:
        response = client._client.get("/signals", params={"select": "id,action,score,reasons,symbols(symbol),rule_versions(rules(name))", "as_of_date": f"eq.{trading_date.isoformat()}", "action": "in.(BUY,SELL,STOP)"})
        response.raise_for_status()
        signals = response.json()
        sent = 0
        for signal in signals:
            exists = client._client.get("/notification_deliveries", params={"select": "id", "signal_id": f"eq.{signal['id']}", "channel": "eq.TELEGRAM", "limit": "1"})
            exists.raise_for_status()
            if exists.json():
                continue
            symbol = signal.get("symbols", {}).get("symbol", "?")
            rule = signal.get("rule_versions", {}).get("rules", {}).get("name", "Rule")
            reasons = " · ".join(signal.get("reasons", [])[:3])
            text = f"Prot Stock EOD · {trading_date:%d/%m/%Y}\n{signal['action']} {symbol} · {rule}\n{reasons}"
            sent_response = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat_id, "text": text}, timeout=20)
            sent_response.raise_for_status()
            client.upsert("notification_deliveries", [{"signal_id": signal["id"], "channel": "TELEGRAM", "payload": {"message": text}}], "signal_id,channel")
            sent += 1
        return {"status": "SUCCEEDED", "sent": sent, "eligible": len(signals)}
    finally:
        client.close()
