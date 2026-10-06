from datetime import date, timedelta

from protstock.audit_champion_baseline import analyze, render_report
from protstock.provider_vnstock import KBS_SOURCE_VERSION, STOCK_PRICE_UNIT


def test_incomplete_audit_never_claims_ground_truth():
    rows = [{"trading_date": (date(2025, 1, 1) + timedelta(days=i)).isoformat(),
             "open": 10, "high": 10.2, "low": 9.7, "close": 10.1,
             "quality_status": "VALID", "price_unit": STOCK_PRICE_UNIT,
             "basis": "KBS_VENDOR_REBASED", "source_version": KBS_SOURCE_VERSION} for i in range(30)]
    snapshot = {"symbols": [{"id": 1, "symbol": "TEST"}],
                "price_status": {"1": {"coverage_status": "MATCHED", "source_version": KBS_SOURCE_VERSION,
                                        "requested_start_date": "2025-01-01", "requested_end_date": "2025-01-30"}},
                "bars": {"1": rows},
                "breadth": [{"trading_date": "2025-01-01", "vnindex_trend_state": "UP"}],
                "champion_signals": [{"symbol_id": 1, "as_of_date": "2025-01-01", "timeframe": "D",
                                      "composite_action": "PROBE_BUY", "consensus_engines": ["core_ladder_v2"]}],
                "raw_signals": [{"symbol_id": 1, "as_of_date": "2025-01-01", "timeframe": "D",
                                 "action": "PROBE_BUY", "evidence": {"invalidation_price": 9.5}}]}
    result = analyze(snapshot, "2025-01-30")
    assert len(result["samples"]) == 1
    assert result["complete"] is False
    report = render_report(result, "2025-01-30")
    assert "CHƯA ĐỦ PHỦ" in report
    assert "UP" in report


def test_audit_uses_active_manifest_instead_of_fixed_272():
    snapshot = {"symbols": [{"id": 1, "symbol": "AAA", "active": True},
                            {"id": 2, "symbol": "OLD", "active": False}],
                "universe_manifest": ["AAA", "BBB"], "bars": {}, "price_status": {}}
    result = analyze(snapshot, "2026-09-30")
    assert result["symbols_total"] == 1
    assert result["universe_mismatch"] == ["BBB"]
    assert result["complete"] is False
    assert "Mã bị loại do giá chưa xác minh: 1 (AAA)." in render_report(result, "2026-09-30")
