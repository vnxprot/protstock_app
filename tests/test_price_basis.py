from datetime import date

from protstock.models import DailyBar
from protstock.price_basis import canonical_price_rows, same_source_window
from protstock.corporate_action_sync import vci_action_rows


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


def test_vendor_event_without_volume_basis_is_quarantined():
    event = {"action_type": "BONUS", "ex_date": "2026-09-15", "ratio": 3,
             "verification_status": "SOURCE_REPORTED", "metadata": {}}
    rows = canonical_price_rows(1, [bar("2026-09-14"), bar("2026-09-15")],
                                [event], as_of_date=date(2026, 9, 15))
    assert rows[0]["volume"] == 100 and rows[0]["quality_status"] == "WARNING"
    assert rows[1]["volume"] == 100 and rows[1]["quality_status"] == "VALID"


def test_mixed_source_or_basis_revision_is_rejected():
    rows = canonical_price_rows(1, [bar("2026-09-14")], [], as_of_date=date(2026, 9, 15))
    assert not same_source_window([*rows, {**rows[0], "source": "KBS_PUBLIC"}])
    assert not same_source_window([*rows, {**rows[0], "data_revision": "another"}])


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


def test_vci_employee_issue_is_classified_without_holder_entitlement():
    class Frame:
        def to_dict(self, _orientation):
            return [{"id": "42", "event_code": "ISS", "event_title_vi": "Phát hành cổ phiếu - Phát hành cho CBCNV tỉ lệ 2.0%",
                     "exright_date": "2026-05-22", "exercise_ratio": 0.02}]

    rows = vci_action_rows(1, Frame())
    assert rows[0]["action_type"] == "OTHER"
    assert rows[0]["metadata"]["entitlement_policy"] == "NO_EXISTING_HOLDER_ENTITLEMENT"
