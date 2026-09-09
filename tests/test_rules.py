import pytest

from protstock.rules import compile_rule, evaluate_rule


def test_compile_vietnamese_buy_rule() -> None:
    rule = compile_rule("Mua khi giá đóng cửa vượt đỉnh 20 phiên và volume lớn hơn 1,5 lần; MA20 > MA50 > MA200; RSI từ 45 đến 70")
    assert rule.action == "BUY"
    assert rule.timeframe == "D"
    assert [item["metric"] for item in rule.conditions] == ["close", "volume_ratio20", "ma_stack", "rsi14"]


def test_compile_stop_loss_rule() -> None:
    rule = compile_rule("Bán cắt lỗ 7%")
    assert rule.action == "SELL"
    assert rule.conditions[0]["value"] == -0.07


def test_evaluate_rule_returns_explainable_evidence() -> None:
    rule = compile_rule("Mua khi vượt đỉnh 3 phiên và volume lớn hơn 1.5 lần").to_dict()
    bars = [{"high": 10, "close": 9}, {"high": 11, "close": 10}, {"high": 12, "close": 11}, {"high": 13, "close": 14}]
    passed, reasons = evaluate_rule(rule, {"volume_ratio20": 2}, bars)
    assert passed is True
    assert reasons == ["close:PASS", "volume_ratio20:PASS"]


def test_unknown_rule_is_rejected() -> None:
    with pytest.raises(ValueError):
        compile_rule("Mua khi cảm thấy đẹp")
