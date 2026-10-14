from datetime import date
from types import SimpleNamespace
import sys

from protstock.intraday_spikes import _fetch_vci_minutes, detect_events, parse_minute_bars


def bars(start=600, count=20, volume=1000, rising=False):
    output = []
    for offset in range(count):
        minute = start + offset
        opening = 20_000 + (offset * 20 if rising else 0)
        output.append({"t": f"{minute // 60:02d}:{minute % 60:02d}", "o": opening,
                       "h": opening + 50, "l": opening - 50,
                       "c": opening + (30 if rising else 0), "v": volume})
    return output


def test_detects_one_burst_across_overlapping_windows():
    history = [bars() for _ in range(20)]
    current = bars(rising=True)
    for item in current[6:11]:
        item["v"] = 20_000
    events = detect_events(1, "2026-10-09", current, history)
    assert len(events) == 1
    assert events[0]["start_time"] <= "10:06" <= events[0]["end_time"]
    assert events[0]["volume_ratio"] >= 3
    assert events[0]["value_vnd"] >= 100_000_000


def test_no_event_with_insufficient_baseline_or_value():
    current = bars(volume=100)
    current[6]["v"] = 3_000
    assert detect_events(1, "2026-10-09", current, [bars(volume=100)] * 9) == []
    assert detect_events(1, "2026-10-09", current, [bars(volume=100)] * 20) == []


def test_spike_ratio_uses_comparable_volume_while_value_keeps_raw_trades():
    history = [[{**item, "cv": item["v"] * 2} for item in bars()] for _ in range(20)]
    current = [{**item, "cv": item["v"]} for item in bars(rising=True)]
    for item in current[6:11]:
        item["v"] = item["cv"] = 6_000
    events = detect_events(1, "2026-10-09", current, history)
    assert len(events) == 1
    assert events[0]["volume_ratio"] == 3
    assert events[0]["volume"] == sum(item["v"] for item in current if events[0]["start_time"] <= item["t"] <= events[0]["end_time"])


def test_parser_keeps_only_requested_trading_minutes():
    payload = {"data_1P": [
        {"t": "2026-10-09 10:02", "o": 20000, "h": 20100, "l": 19900, "c": 20050, "v": 1000},
        {"t": "2026-10-09 12:02", "o": 20000, "h": 20100, "l": 19900, "c": 20050, "v": 1000},
        {"t": "2026-10-08 10:02", "o": 20000, "h": 20100, "l": 19900, "c": 20050, "v": 1000},
    ]}
    result = parse_minute_bars(payload, "VCB", date(2026, 10, 9), date(2026, 10, 9))
    assert [item["t"] for item in result["2026-10-09"]] == ["10:02"]


def test_vci_minute_candles_use_vnd_without_changing_volume(monkeypatch):
    class Frame:
        attrs = {"source": "vci"}
        def itertuples(self, index=False):
            return iter([SimpleNamespace(time="2026-10-09 10:02:00+07:00", open=20,
                                         high=20.1, low=19.9, close=20.05, volume=1000)])
    class Market:
        def equity(self, symbol):
            assert symbol == "VCB"
            return self
        def ohlcv(self, **kwargs):
            assert kwargs["source"] == "vci" and kwargs["interval"] == "1m"
            return Frame()
    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(Market=Market, __version__="5.0.0"))
    candles = _fetch_vci_minutes("VCB", date(2026, 10, 9), date(2026, 10, 9))
    assert candles["2026-10-09"][0]["c"] == 20050
    assert candles["2026-10-09"][0]["v"] == 1000


def test_vci_minute_candles_wait_for_free_minute_quota(monkeypatch):
    class EntitlementError(Exception):
        pass

    calls = []
    waits = []

    class Frame:
        attrs = {"source": "vci"}

        def itertuples(self, index=False):
            return iter([SimpleNamespace(time="2026-10-09 10:02:00+07:00", open=20,
                                         high=20.1, low=19.9, close=20.05, volume=1000)])

    class Market:
        def equity(self, _symbol): return self

        def ohlcv(self, **_kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise EntitlementError("The per-minute quota has been reached (60/60 calls)")
            return Frame()

    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(Market=Market, __version__="5.0.0"))
    monkeypatch.setattr("protstock.intraday_spikes.sleep", waits.append)
    result = _fetch_vci_minutes("VCB", date(2026, 10, 9), date(2026, 10, 9))
    assert result["2026-10-09"][0]["v"] == 1000
    assert len(calls) == 2 and waits == [65]
