from datetime import date

from protstock import alerts
from protstock.pattern_archive import archive_evidence_if_eligible


def test_archive_only_terminal_patterns_with_scored_signals() -> None:
    cutoff = date(2026, 1, 1)
    failed = {"state": "FAILED", "as_of_date": "2025-01-01", "evidence": {"raw": "large"}}
    assert archive_evidence_if_eligible(failed, [{"signal_outcomes": [{"horizon_days": 20}]}], cutoff)["evidence"] is None
    assert archive_evidence_if_eligible(failed, [{"signal_outcomes": []}], cutoff)["evidence"] == {"raw": "large"}
    confirmed = {**failed, "state": "CONFIRMED"}
    assert archive_evidence_if_eligible(confirmed, [{"signal_outcomes": [{"horizon_days": 20}]}], cutoff)["evidence"] == {"raw": "large"}


class _Response:
    def __init__(self, rows): self.rows = rows
    def raise_for_status(self): pass
    def json(self): return self.rows


class _Rest:
    def __init__(self, action: str, prior_days: int):
        self.action, self.prior_days = action, prior_days
    def get(self, path, params=None):
        if path == "/effective_signals":
            return _Response([{ "signal_id": "new", "symbol_id": 7, "symbol": "FPT", "action": self.action, "reasons": [], "kind": "CORE_PACK", "rule_name": "Test Pack", "pack_version": "v1.0", "notification_mode": "TELEGRAM" }])
        if params.get("signal_id") == "eq.new":
            return _Response([])
        # This is the REDUCE-only historical-delivery query.
        return _Response([{"id": "old"}] if self.prior_days <= 5 else [])


class _Client:
    def __init__(self, action, prior_days):
        self._client = _Rest(action, prior_days)
        self.writes = []
    def upsert(self, table, rows, conflict):
        self.writes.extend(rows)
        return len(rows)
    def close(self): pass


def _send(monkeypatch, action: str, prior_days: int):
    client = _Client(action, prior_days)
    sent = []
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "chat")
    monkeypatch.setattr(alerts, "SupabaseRestClient", lambda _settings: client)
    monkeypatch.setattr(alerts.Settings, "from_env", lambda: object())
    monkeypatch.setattr(alerts.httpx, "post", lambda *args, **kwargs: sent.append(kwargs["json"]["text"]) or _Response({"ok": True}))
    return alerts.send_eod_telegram_alerts(date(2026, 9, 11)), sent


def test_reduce_dedupe_is_action_specific_and_time_bounded(monkeypatch) -> None:
    reduced, reduced_messages = _send(monkeypatch, "REDUCE", 2)
    assert reduced == {"status": "SUCCEEDED", "sent": 0, "deduped": 1, "eligible": 1}
    assert reduced_messages == []
    exited, exit_messages = _send(monkeypatch, "EXIT", 2)
    assert exited["sent"] == 1 and exited["deduped"] == 0 and len(exit_messages) == 1
    older_reduce, older_messages = _send(monkeypatch, "REDUCE", 6)
    assert older_reduce["sent"] == 1 and older_reduce["deduped"] == 0 and len(older_messages) == 1
