from protstock.flow import calculate_flow
from protstock.resolution import classify_signal_state


def bars(direction: int):
    return [
        {"open": 10 + index * direction, "high": 11 + index * direction, "low": 9 + index * direction, "close": 10.8 + index * direction, "volume": 1_000 + index * 20}
        for index in range(22)
    ]


def test_flow_uses_only_ohlcv_and_classifies_strong_inflow():
    result = calculate_flow(bars(1))
    assert result["flow_state"] in {"GREEN", "PURPLE"}
    assert result["cmf20"] is not None


def test_watch_states_distinguish_setup_from_extended_leader():
    assert classify_signal_state("WATCH", ["NEAR_TRIGGER_BULL_FLAG"]) == "WATCH_SETUP"
    assert classify_signal_state("WATCH", ["RSI_NOT_ELIGIBLE"]) == "EXTENDED"
