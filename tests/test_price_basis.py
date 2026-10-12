from datetime import date

from protstock.models import DailyBar
from protstock.price_basis import canonical_price_rows, same_source_window


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
