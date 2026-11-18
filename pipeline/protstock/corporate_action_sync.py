"""Import VCI event candidates; only independent verification enables factors."""

from __future__ import annotations

from datetime import date, timedelta
from collections import defaultdict
from hashlib import sha256
from json import dumps
from time import sleep

from .config import Settings, vietnam_today
from .ssi_market_data import configured, market_data, ssi_date
from .supabase_rest import SupabaseRestClient


def _date(value) -> str | None:
    if value is None or str(value) in {"NaT", "nan", "None"}:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        return None


def _number(value) -> float | None:
    if value is None or str(value) in {"NaT", "nan", "None"}:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def vci_action_rows(symbol_id: int, frame) -> list[dict]:
    result = []
    for raw in (frame.to_dict("records") if hasattr(frame, "to_dict") else frame):
        code = str(raw.get("event_code") or "").upper()
        title = str(raw.get("event_title_vi") or "").lower()
        ex_date = _date(raw.get("exright_date"))
        if not ex_date or code not in {"DIV", "ISS"}:
            continue
        if code == "DIV":
            action_type = "CASH_DIVIDEND"
        elif "cổ phiếu thưởng" in title:
            action_type = "BONUS"
        elif "cổ tức bằng cổ phiếu" in title:
            action_type = "STOCK_DIVIDEND"
        elif "quyền mua" in title:
            action_type = "RIGHTS_ISSUE"
        else:
            action_type = "OTHER"
        ratio = _number(raw.get("exercise_ratio"))
        amount = _number(raw.get("value_per_share"))
        content = [str(raw.get("id") or ""), action_type, ex_date, ratio, amount]
        result.append({
            "symbol_id": symbol_id, "action_type": action_type,
            "ex_date": ex_date, "record_date": _date(raw.get("record_date")),
            "payment_date": _date(raw.get("payout_date")),
            "ratio": ratio, "cash_amount": amount if action_type == "CASH_DIVIDEND" else None,
            "source": "VCI_DIRECT_EVENTS", "content_hash": sha256(dumps(content).encode()).hexdigest(),
            "verification_status": "SOURCE_REPORTED",
            "metadata": {"provider_event_id": str(raw.get("id") or ""),
                         "event_title": str(raw.get("event_title_vi") or ""),
                         "event_code": code, "public_date": _date(raw.get("public_date"))},
        })
        if action_type == "OTHER" and any(label in title for label in (
            "cho cbcnv", "phát hành riêng lẻ", "trái phiếu chuyển đổi",
            "qua đấu giá", "để sáp nhập", "cho trái chủ",
        )):
            result[-1]["metadata"]["entitlement_policy"] = "NO_EXISTING_HOLDER_ENTITLEMENT"
    return result


def ssi_event_dates(today):
    confirmed = defaultdict(list)
    if not configured():
        return confirmed
    try:
        for offset in (-10, -4, 2):
            first = today + timedelta(days=offset)
            for event in market_data().corporate_actions(first, first + timedelta(days=5)):
                if event.get("exrightDate"):
                    key = (event["symbol"], ssi_date(event["exrightDate"]).isoformat())
                    confirmed[key].append(event)
    except Exception as error:
        print(f"::notice::SSI corporate-action calendar unavailable: {type(error).__name__}", flush=True)
    return confirmed


def sync_corporate_actions(*, symbols: set[str] | None = None, pause_seconds: float = 6.5,
                           calendar_window_days: int | None = None) -> dict:
    from .market_sources import vci_events

    client = SupabaseRestClient(Settings.from_env())
    counts = {"symbols": 0, "events": 0, "failed": []}
    try:
        candidates = client.active_symbols()
        if calendar_window_days is not None and calendar_window_days < 1:
            raise ValueError("calendar_window_days must be positive")
        today = vietnam_today()
        ssi_dates = ssi_event_dates(today)
        first_day = today - timedelta(days=7) if calendar_window_days else date(2021, 1, 1)
        last_day = today + timedelta(days=calendar_window_days or 365)
        if symbols is not None:
            candidates = [row for row in candidates if row["symbol"] in symbols]
        for item in candidates:
            try:
                frame = vci_events(item["symbol"], first_day, last_day)
                rows = vci_action_rows(item["id"], frame)
                for row in rows:
                    candidates_on_date = ssi_dates[(item["symbol"], row["ex_date"])]
                    # Use SSI's record date when an announcement matches unambiguously.
                    title = " ".join(row["metadata"]["event_title"].casefold().split())
                    matching = [event for event in candidates_on_date
                                if " ".join(event.get("eventTitle", "").casefold().split()) == title]
                    if len(matching) == 1:
                        event = matching[0]
                        row["metadata"]["ssi_event_title"] = event["eventTitle"]
                        if event.get("recordDate"):
                            row["record_date"] = ssi_date(event["recordDate"]).isoformat()
                existing_hashes = {row.get("content_hash") for row in client.corporate_actions(item["id"])}
                new_rows = [row for row in rows if row["content_hash"] not in existing_hashes]
                if new_rows:
                    client.upsert("corporate_actions", new_rows, "symbol_id,action_type,ex_date,content_hash")
                counts["events"] += len(new_rows)
                counts["symbols"] += 1
            except Exception as exc:
                counts["failed"].append({"symbol": item["symbol"], "error": str(exc)[:180]})
            if pause_seconds:
                sleep(pause_seconds)
        return counts
    finally:
        client.close()
