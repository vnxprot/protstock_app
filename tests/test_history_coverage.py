from datetime import date

from protstock.history_coverage import assess_symbol_coverage, build_history_coverage


def test_coverage_uses_listed_from_to_separate_valid_pre_listing_sessions() -> None:
    report = assess_symbol_coverage(
        {"id": 1, "symbol": "NEW", "listed_from": "2021-01-05"},
        ["2021-01-04", "2021-01-05", "2021-01-06", "2021-01-07"],
        ["2021-01-05", "2021-01-07"],
        date(2021, 1, 1),
    )

    assert report["coverage_start_basis"] == "LISTED_FROM"
    assert report["pre_listing_session_count"] == 1
    assert report["missing_after_coverage_start"] == ["2021-01-06"]


def test_coverage_does_not_call_unknown_early_history_a_repairable_gap() -> None:
    report = assess_symbol_coverage(
        {"id": 1, "symbol": "OLD", "listed_from": None},
        ["2021-01-04", "2021-01-05", "2021-01-06", "2021-01-07"],
        ["2021-01-06"],
        date(2021, 1, 1),
    )

    assert report["coverage_start_basis"] == "FIRST_OBSERVED_BAR"
    assert report["unclassified_before_first_observation_count"] == 2
    assert report["missing_after_coverage_start"] == ["2021-01-07"]


def test_history_coverage_aggregates_repairable_gaps_without_hiding_rows() -> None:
    report = build_history_coverage(
        [{"id": 1, "symbol": "AAA", "listed_from": "2021-01-04"}, {"id": 2, "symbol": "BBB", "listed_from": None}],
        ["2021-01-04", "2021-01-05"],
        {1: ["2021-01-04"], 2: ["2021-01-05"]},
        date(2021, 1, 1),
        date(2021, 1, 5),
    )

    assert report["symbols_with_repairable_gaps"] == 1
    assert report["repairable_missing_sessions"] == 1
    assert report["rows"][0]["symbol"] == "AAA"
