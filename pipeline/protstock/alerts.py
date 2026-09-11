from __future__ import annotations

import os
from datetime import date, timedelta

import httpx

from .config import Settings
from .supabase_rest import SupabaseRestClient


def build_telegram_message(signal: dict, trading_date: date) -> str:
    """Render the signal with its pack/rule provenance, including legacy rows."""
    symbol = signal.get("symbol") or (signal.get("symbols") or {}).get("symbol", "?")
    rule_data = (signal.get("rule_versions") or {}).get("rules") or {}
    kind = signal.get("kind") or rule_data.get("kind")
    name = signal.get("rule_name") or rule_data.get("name")
    pack_version = signal.get("pack_version") or rule_data.get("pack_version")
    if kind == "CORE_PACK" and name:
        rule = name if pack_version and str(name).endswith(str(pack_version)) else f"{name} {pack_version}".strip()
    elif kind == "USER_RULE" and name:
        rule = f"Rule Studio: {name}"
    elif name:
        # Pre-Tier-4 user-rule rows have no kind but retain their old label.
        rule = name
    else:
        rule = "Prot Core Engine"
    reasons = " · ".join(signal.get("reasons", [])[:3])
    return f"Prot Stock EOD · {trading_date:%d/%m/%Y}\n{signal['action']} {symbol} · {rule}\n{reasons}"


def _reduce_recently_notified(client: SupabaseRestClient, symbol_id: int, trading_date: date, dedupe_days: int) -> bool:
    response = client._client.get(
        "/notification_deliveries",
        params={
            "select": "id,consolidated_signals!inner(symbol_id,composite_action)",
            "channel": "eq.TELEGRAM",
            "delivered_at": f"gte.{(trading_date - timedelta(days=dedupe_days)).isoformat()}",
            "consolidated_signals.symbol_id": f"eq.{symbol_id}",
            "consolidated_signals.composite_action": "eq.REDUCE",
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
        response = client._client.get("/consolidated_signals", params={"select": "id,symbol_id,composite_action,confluence_score,confluence_count,consensus_engines,reasons,symbols!inner(symbol)", "as_of_date": f"eq.{trading_date.isoformat()}", "composite_action": "in.(PROBE_BUY,ADD,REDUCE,EXIT)"})
        response.raise_for_status()
        signals = [{**signal, "signal_id": signal.get("id") or signal.get("signal_id"), "action": signal.get("composite_action") or signal.get("action"), "symbol": signal.get("symbol") or (signal.get("symbols") or {}).get("symbol", "?"), "rule_name": "Prot Consensus", "kind": "CORE_PACK"} for signal in response.json() if signal.get("notification_mode", "TELEGRAM") == "TELEGRAM"]
        sent = deduped = 0
        for signal in signals:
            signal_id = signal.get("signal_id") or signal["id"]
            exists = client._client.get("/notification_deliveries", params={"select": "id", "consolidated_signal_id": f"eq.{signal_id}", "channel": "eq.TELEGRAM", "limit": "1"})
            exists.raise_for_status()
            if exists.json():
                continue
            if signal["action"] == "REDUCE" and _reduce_recently_notified(client, signal["symbol_id"], trading_date, reduce_dedupe_days):
                deduped += 1
                continue
            text = build_telegram_message(signal, trading_date)
            sent_response = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat_id, "text": text}, timeout=20)
            sent_response.raise_for_status()
            client.upsert("notification_deliveries", [{"consolidated_signal_id": signal_id, "channel": "TELEGRAM", "payload": {"message": text}}], "consolidated_signal_id,channel")
            sent += 1
        return {"status": "SUCCEEDED", "sent": sent, "deduped": deduped, "eligible": len(signals)}
    finally:
        client.close()
