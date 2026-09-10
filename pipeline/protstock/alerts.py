from __future__ import annotations

import os
from datetime import date, timedelta

import httpx

from .config import Settings
from .supabase_rest import SupabaseRestClient


def build_telegram_message(signal: dict, trading_date: date) -> str:
    """Render either a user-rule signal or a rule-less Core Engine decision."""
    symbol = (signal.get("symbols") or {}).get("symbol", "?")
    rule_data = (signal.get("rule_versions") or {}).get("rules") or {}
    rule = rule_data.get("name") or "Prot Core Engine"
    reasons = " · ".join(signal.get("reasons", [])[:3])
    return f"Prot Stock EOD · {trading_date:%d/%m/%Y}\n{signal['action']} {symbol} · {rule}\n{reasons}"


def _reduce_recently_notified(client: SupabaseRestClient, symbol_id: int, trading_date: date, dedupe_days: int) -> bool:
    response = client._client.get(
        "/notification_deliveries",
        params={
            "select": "id,signals!inner(symbol_id,action)",
            "channel": "eq.TELEGRAM",
            "delivered_at": f"gte.{(trading_date - timedelta(days=dedupe_days)).isoformat()}",
            "signals.symbol_id": f"eq.{symbol_id}",
            "signals.action": "eq.REDUCE",
            "limit": "1",
        },
    )
    response.raise_for_status()
    return bool(response.json())


def send_eod_telegram_alerts(trading_date: date, reduce_dedupe_days: int = 5) -> dict:
    token, chat_id = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return {"status": "DISABLED", "reason": "Telegram secrets are not configured"}
    client = SupabaseRestClient(Settings.from_env())
    try:
        response = client._client.get("/signals", params={"select": "id,symbol_id,action,score,reasons,symbols(symbol),rule_versions(rules(name))", "as_of_date": f"eq.{trading_date.isoformat()}", "action": "in.(PROBE_BUY,ADD,REDUCE,EXIT)"})
        response.raise_for_status()
        signals = response.json()
        sent = deduped = 0
        for signal in signals:
            exists = client._client.get("/notification_deliveries", params={"select": "id", "signal_id": f"eq.{signal['id']}", "channel": "eq.TELEGRAM", "limit": "1"})
            exists.raise_for_status()
            if exists.json():
                continue
            if signal["action"] == "REDUCE" and _reduce_recently_notified(client, signal["symbol_id"], trading_date, reduce_dedupe_days):
                deduped += 1
                continue
            text = build_telegram_message(signal, trading_date)
            sent_response = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat_id, "text": text}, timeout=20)
            sent_response.raise_for_status()
            client.upsert("notification_deliveries", [{"signal_id": signal["id"], "channel": "TELEGRAM", "payload": {"message": text}}], "signal_id,channel")
            sent += 1
        return {"status": "SUCCEEDED", "sent": sent, "deduped": deduped, "eligible": len(signals)}
    finally:
        client.close()
