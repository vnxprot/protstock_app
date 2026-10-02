import json
from pathlib import Path
import shutil
import subprocess
from datetime import date, timedelta
from math import sin

import pytest

from protstock.indicators import calculate_indicators
from protstock.rules import compile_rule, evaluate_rule
from protstock.flow import calculate_flow
from protstock.market_regime import compute_breadth

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    "Mua khi giá đóng cửa vượt đỉnh 20 phiên và volume lớn hơn 1,5 lần; MA20 > MA50 > MA200; RSI từ 45 đến 70",
    "Theo dõi khi vượt đỉnh 20 phiên",
    "Bán cắt lỗ 7%",
    "Thoát khi RSI từ 70 đến 90",
    "Bán hết khi hai đỉnh xác nhận",
    "Giảm tỷ trọng khi RSI từ 70 đến 90",
    "Mua khi vượt đỉnh 20 phiên và bán khi RSI từ 70 đến 90",
    "Mua cắt lỗ 7%",
    "Mua khi hai đáy xác nhận, volume > 1.3 lần, cắt lỗ 7%",
    "Theo dõi tam giác tăng sẵn sàng khung tuần",
    "Mua khi RSI từ 45 đến 70 và khối lượng > 1,5 lần",
    "Mua khi vượt đỉnh 20 phiên và ROE lớn hơn 15%",
    "Mua khi RSI từ 70 đến 45",
    "Mua khi vượt đỉnh 0 phiên",
    "Mua khi vượt đỉnh 20 phiên hoặc volume > 1.5 lần",
    "Mua khi vượt đỉnh 20 phiên, RSI từ 45 đến 70, RSI từ 40 đến 60",
    "Mua khi vượt đỉnh 20 phiên và cắt lỗ 100%",
]
NODE_SCRIPT = """
import fs from 'node:fs';
import { compileRuleText } from './src/lib/ruleDsl.ts';
import { calculateMacd } from './src/lib/macd.ts';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const rules = input.texts.map(text => { try { return {dsl:compileRuleText(text)} } catch(error) { return {error:error.message} } });
process.stdout.write(JSON.stringify({rules, macd:calculateMacd(input.bars)}));
"""


def node_result(texts, bars):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node runtime unavailable for cross-language parity")
    result = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", NODE_SCRIPT],
                            input=json.dumps({"texts": texts, "bars": bars}, ensure_ascii=False),
                            text=True, encoding="utf-8", capture_output=True, cwd=ROOT, timeout=20)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_python_and_frontend_grammar_accept_reject_and_dsl_are_identical():
    actual = node_result(CASES, [])["rules"]
    for text, frontend in zip(CASES, actual):
        try:
            expected = {"dsl": compile_rule(text).to_dict()}
        except ValueError as exc:
            expected = {"error": str(exc)}
        assert frontend == expected, text


def test_macd_closed_bars_sorting_seed_and_pre2021_warmup_match_python():
    first = date(2020, 12, 1)
    rows = [{"trading_date": (first + timedelta(days=i)).isoformat(), "open": 20 + i * .12 + sin(i),
             "high": 22 + i * .12 + sin(i), "low": 18 + i * .12 + sin(i),
             "close": 21 + i * .12 + sin(i), "volume": 1_000_000} for i in range(64)]
    forming = {**rows[-1], "trading_date": "2021-02-04", "close": 999, "is_complete": False}
    points = node_result([], [forming, *reversed(rows)])["macd"]
    assert len(points) == len(rows) - 25
    assert points[0]["time"] < "2021-01-01"
    for index, point in enumerate(points, 25):
        snapshot = calculate_indicators(rows[:index + 1])
        assert point["macd"] == pytest.approx(snapshot.macd, abs=1e-12)
        if snapshot.macd_signal is None:
            assert point["signal"] is None and point["histogram"] is None
        else:
            assert point["signal"] == pytest.approx(snapshot.macd_signal, abs=1e-12)
            assert point["histogram"] == pytest.approx(snapshot.macd_histogram, abs=1e-12)


def test_macd_linear_series_has_seven_point_gap_after_seed():
    bars = [{"open": 10 + i, "high": 11 + i, "low": 9 + i, "close": 10 + i, "volume": 100} for i in range(34)]
    snapshot = calculate_indicators(bars)
    assert snapshot.macd == pytest.approx(7)
    assert snapshot.macd_signal == pytest.approx(7)
    assert snapshot.macd_histogram == pytest.approx(0)


def test_mixed_entry_stop_is_risk_and_standalone_exit_uses_position_cost():
    dsl = compile_rule("Mua khi vượt đỉnh 20 phiên và cắt lỗ 7%").to_dict()
    assert dsl["action"] == "PROBE_BUY" and dsl["risk"]["stop_loss_pct"] == .07
    assert all(item["metric"] != "return_from_entry" for item in dsl["all"])
    stop = compile_rule("Bán cắt lỗ 7%").to_dict()
    assert evaluate_rule(stop, {"close": 18}, [], context={"position": {"average_cost": 20}})[0]
    assert not evaluate_rule(stop, {"close": 18}, [], context={})[0]


def test_breakout_requires_full_lookback():
    rule = compile_rule("Mua khi vượt đỉnh 20 phiên").to_dict()
    assert not evaluate_rule(rule, {}, [{"high": 10, "close": 9}, {"high": 11, "close": 20}])[0]


def test_health_unknown_long_history_is_not_a_bearish_vote():
    snapshot = {"symbol_id": 1, "close": 20, "sma20": 10, "sma50": 9, "sma200": None, "ma_stack": False}
    breadth = compute_breadth([snapshot], {1: {"close": 19}}, {1: "TEST"})
    assert breadth["pct_above_sma200"] is None and breadth["pct_ma_stack"] is None
    assert breadth["market_health_score"] == 100
    assert breadth["health_components"]["above_sma200"]["valid_count"] == 0
    assert breadth["sector_breadth"][0]["sample_warning"] == "SMALL_SAMPLE"
    assert breadth["health_method_version"] == "health-v4.0.0"


def test_health_sma200_denominator_only_counts_observed_history():
    items = [{"symbol_id": 1, "close": 20, "sma50": 10, "sma200": 15},
             {"symbol_id": 2, "close": 20, "sma50": 10, "sma200": None}]
    breadth = compute_breadth(items)
    assert breadth["pct_above_sma200"] == 100
    assert breadth["health_components"]["above_sma200"]["coverage_pct"] == 50


def test_flow_requires_twenty_completed_observations():
    rows = [{"open": 10, "high": 11, "low": 9, "close": 10, "volume": 100} for _ in range(19)]
    assert calculate_flow(rows)["flow_state"] == "UNKNOWN"
    assert calculate_flow(rows)["flow_score"] is None
    assert calculate_flow([*rows, {**rows[-1], "is_complete": False}])["flow_state"] == "UNKNOWN"

def test_exit_and_reduce_actions_are_distinct_and_conflicting_actions_fail():
    assert compile_rule("Thoát khi RSI từ 70 đến 90").action == "EXIT"
    assert compile_rule("Bán hết khi hai đỉnh xác nhận").action == "EXIT"
    assert compile_rule("Giảm tỷ trọng khi RSI từ 70 đến 90").action == "REDUCE"
    with pytest.raises(ValueError, match="một hành động"):
        compile_rule("Mua khi vượt đỉnh 20 phiên và bán khi RSI từ 70 đến 90")
    with pytest.raises(ValueError, match="điều kiện thoát"):
        compile_rule("Mua cắt lỗ 7%")
