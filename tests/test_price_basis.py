from datetime import date, timedelta
import pytest

from protstock.models import DailyBar
from protstock.price_basis import (canonical_price_rows, same_source_window,
                                   volume_window_is_comparable, with_volume_segments, latest_coherent_suffix,
                                   price_row_usable)
from protstock.corporate_action_sync import vci_action_rows
from protstock.indicators import calculate_indicators
from protstock.flow import calculate_flow
from protstock.analysis import analyze_bars


def bar(day: str, volume: int = 100) -> DailyBar:
    return DailyBar.create(symbol="TRC", trading_date=date.fromisoformat(day),
                           open=20, high=21, low=19, close=20, volume=volume,
                           source="VCI_VNSTOCK_5.0.0")


def test_verified_event_rebases_volume_once_despite_duplicate_vendor_report():
    event = {"action_type": "BONUS", "ex_date": "2026-09-15", "ratio": 3,
             "verification_status": "OFFICIAL", "metadata": {"volume_policy": "UNADJUSTED_PRE_EVENT"}}
    vendor_copy = {**event, "verification_status": "SOURCE_REPORTED", "metadata": {}}
    rows = canonical_price_rows(1, [bar("2026-09-14"), bar("2026-09-15")],
                                [vendor_copy, event], as_of_date=date(2026, 9, 15))
    assert [row["volume"] for row in rows] == [400, 100]
    assert [row["source_volume"] for row in rows] == [100, 100]
    assert rows[0]["quality_status"] == "VALID"
    assert same_source_window(rows)


def test_vendor_event_keeps_price_valid_and_separates_volume_windows():
    event = {"action_type": "BONUS", "ex_date": "2026-09-15", "ratio": 3,
             "verification_status": "SOURCE_REPORTED", "metadata": {}}
    rows = canonical_price_rows(1, [bar("2026-09-14"), bar("2026-09-15")],
                                [event], as_of_date=date(2026, 9, 15))
    assert rows[0]["volume"] == 100 and rows[0]["quality_status"] == "VALID"
    assert rows[1]["volume"] == 100 and rows[1]["quality_status"] == "VALID"
    assert not volume_window_is_comparable(rows)


def test_stored_warning_prices_remain_usable_and_multiple_events_have_distinct_volume_segments():
    events = [{"action_type": "BONUS", "ex_date": day, "ratio": 0.1,
               "verification_status": "SOURCE_REPORTED", "metadata": {}}
              for day in ("2026-02-01", "2026-03-01")]
    stored = [{"trading_date": day, "volume_basis": "UNVERIFIED_SHARE_EVENT",
               "volume_adjustment_factor": 1, "price_basis": "VENDOR_CORPORATE_ACTION_ADJUSTED",
               "quality_status": "WARNING", "data_revision": "one-vendor-revision"}
              for day in ("2026-01-15", "2026-02-15", "2026-03-15")]
    segmented = with_volume_segments(stored, events, as_of_date=date(2026, 3, 15))
    assert all(price_row_usable(row) for row in segmented)
    assert len({row["volume_basis"] for row in segmented}) == 3
    assert not volume_window_is_comparable(segmented[:2])
    assert not price_row_usable({**stored[0], "price_basis": "LEGACY_UNVERIFIED"})


def test_conflicting_vendor_ratios_keep_auditable_volume_segments():
    first = {"action_type": "STOCK_DIVIDEND", "ex_date": "2026-09-15", "ratio": 0.1,
             "verification_status": "SOURCE_REPORTED", "metadata": {}}
    second = {**first, "ratio": 0.2}
    rows = canonical_price_rows(1, [bar("2026-09-14"), bar("2026-09-15")],
                                [first, second], as_of_date=date(2026, 9, 15))
    assert [row["quality_status"] for row in rows] == ["VALID", "VALID"]
    assert [row["volume_adjustment_factor"] for row in rows] == [1, 1]
    with pytest.raises(ValueError, match="Conflicting verified"):
        canonical_price_rows(1, [bar("2026-09-14")],
                             [{**first, "verification_status": "VERIFIED"},
                              {**second, "verification_status": "VERIFIED"}],
                             as_of_date=date(2026, 9, 15))


def test_mixed_source_or_basis_revision_is_rejected():
    rows = canonical_price_rows(1, [bar("2026-09-14")], [], as_of_date=date(2026, 9, 15))
    assert not same_source_window([*rows, {**rows[0], "source": "KBS_PUBLIC"}])
    assert not same_source_window([*rows, {**rows[0], "data_revision": "another"}])


def test_latest_coherent_suffix_excludes_legacy_kbs_without_mixing_bases():
    current = canonical_price_rows(1, [bar("2026-09-14"), bar("2026-09-15")], [],
                                   as_of_date=date(2026, 9, 15))
    legacy = {**current[0], "trading_date": "2021-01-04", "source": "VNSTOCK_KBS",
              "data_revision": None, "price_basis": "LEGACY_UNVERIFIED"}
    assert latest_coherent_suffix([legacy, *current]) == current
    assert latest_coherent_suffix([*current, legacy]) == current
    assert latest_coherent_suffix([legacy]) == []


def test_cash_event_changes_revision_and_refreshes_whole_price_window():
    original = canonical_price_rows(1, [bar("2026-09-14")], [], as_of_date=date(2026, 9, 15))
    action = {"action_type": "CASH_DIVIDEND", "ex_date": "2026-09-15",
              "cash_amount": 1000, "verification_status": "SOURCE_REPORTED"}
    revised = canonical_price_rows(1, [bar("2026-09-14")], [action], as_of_date=date(2026, 9, 15))
    assert revised[0]["data_revision"] != original[0]["data_revision"]
    assert revised[0]["volume_adjustment_factor"] == 1


def test_employee_placement_stays_in_ledger_without_blocking_holder_volume():
    placement = {"action_type": "OTHER", "ex_date": "2025-09-12", "ratio": 0.015,
                 "verification_status": "SOURCE_REPORTED",
                 "metadata": {"entitlement_policy": "NO_EXISTING_HOLDER_ENTITLEMENT"}}
    rows = canonical_price_rows(1, [bar("2025-09-11"), bar("2025-09-12")],
                                [placement], as_of_date=date(2025, 9, 12))
    assert all(row["quality_status"] == "VALID" for row in rows)
    assert all(row["volume_adjustment_factor"] == 1 for row in rows)


def test_price_indicators_survive_unverified_event_while_volume_waits_for_20_prior_bars():
    start = date(2026, 1, 1)
    bars = [DailyBar.create(symbol="TRC", trading_date=start + timedelta(days=index),
                            open=20 + index / 10, high=21 + index / 10,
                            low=19 + index / 10, close=20 + index / 10,
                            volume=100 + index, source="VCI_VNSTOCK_5.0.0")
            for index in range(80)]
    event = {"action_type": "BONUS", "ex_date": (start + timedelta(days=60)).isoformat(),
             "ratio": 0.1, "verification_status": "SOURCE_REPORTED", "metadata": {}}
    rows = canonical_price_rows(1, bars, [event], as_of_date=start + timedelta(days=79))
    recent = rows[:70]
    indicators = calculate_indicators(recent)
    assert indicators.sma50 is not None and indicators.macd is not None
    assert indicators.volume_ratio20 is None
    assert calculate_flow(recent)["flow_score"] is None
    assert calculate_indicators(rows).volume_ratio20 is None  # 20 post-event bars still need one prior bar
    final = canonical_price_rows(1, [*bars, DailyBar.create(
        symbol="TRC", trading_date=start + timedelta(days=80), open=28, high=29,
        low=27, close=28, volume=180, source="VCI_VNSTOCK_5.0.0")],
        [event], as_of_date=start + timedelta(days=80))
    assert calculate_indicators(final).volume_ratio20 is not None


def test_price_indicators_survive_a_fully_quarantined_volume_segment():
    start = date(2026, 1, 1)
    rows = canonical_price_rows(1, [bar((start + timedelta(days=index)).isoformat())
                                    for index in range(80)], [], as_of_date=start + timedelta(days=79))
    rows = [{**row, "date": row["trading_date"]} for row in rows]
    rows[-1]["volume_basis"] = "MIXED_UNVERIFIED_VOLUME"
    result = analyze_bars(rows)
    assert result["indicators"]["sma50"] is not None
    assert result["patterns"] == [] and result["zones"] == []
    assert result["indicators"]["flow_score"] is None


def test_vci_employee_issue_is_classified_without_holder_entitlement():
    class Frame:
        def to_dict(self, _orientation):
            return [{"id": "42", "event_code": "ISS", "event_title_vi": "Phát hành cổ phiếu - Phát hành cho CBCNV tỉ lệ 2.0%",
                     "exright_date": "2026-05-22", "exercise_ratio": 0.02}]

    rows = vci_action_rows(1, Frame())
    assert rows[0]["action_type"] == "OTHER"
    assert rows[0]["metadata"]["entitlement_policy"] == "NO_EXISTING_HOLDER_ENTITLEMENT"
