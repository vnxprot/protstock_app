from datetime import date

from protstock.eod import _fetch_history_with_retry, _rows_as_of


class RateLimitedProvider:
    def __init__(self) -> None:
        self.calls = 0

    def history(self, *_args):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("Rate limit exceeded")
        return ["ok"]


def test_rate_limit_is_retried(monkeypatch) -> None:
    monkeypatch.setattr("protstock.eod.sleep", lambda _: None)
    provider = RateLimitedProvider()
    assert _fetch_history_with_retry(provider, "FPT", date(2026, 1, 1), date(2026, 1, 2)) == ["ok"]
    assert provider.calls == 2


def test_rows_as_of_excludes_future_bars() -> None:
    rows = [
        {"trading_date": "2026-09-08", "close": 10},
        {"trading_date": "2026-09-09", "close": 11},
        {"trading_date": "2026-09-10", "close": 12},
    ]
    assert _rows_as_of(rows, date(2026, 9, 9)) == rows[:2]
