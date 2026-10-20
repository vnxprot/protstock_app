import importlib.util
from pathlib import Path

import pytest


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / ".github/scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_both_lots_start_before_wait_and_failure_is_retained(monkeypatch):
    module = load("eod_parallel")
    calls = []
    class Worker:
        def __init__(self, command, env):
            calls.append(("start", env["SYMBOL_MANIFEST"]))
        def wait(self):
            calls.append(("wait", ""))
            return 1 if len(calls) == 3 else 0
        def poll(self):
            return 0
    monkeypatch.setattr(module.subprocess, "Popen", Worker)
    assert module.run_lots({"include": [{"shard": 1, "symbols": "AAA"}, {"shard": 2, "symbols": "BBB"}]}) == 1
    assert [call[0] for call in calls] == ["start", "start", "wait", "wait"]


def test_reject_overlapping_lots():
    with pytest.raises(ValueError, match="overlap"):
        load("eod_parallel").run_lots({"include": [{"shard": 1, "symbols": "AAA"}, {"shard": 2, "symbols": "AAA"}]})


def test_report_explains_failure_before_ingest():
    report = load("eod_report").message({"ingest": {"result": "failure", "outputs": {"source_ready": "failure"}}}, "2026-10-19", "run-link")
    assert "hai lô chưa tải dữ liệu" in report
    assert "run-link" in report
