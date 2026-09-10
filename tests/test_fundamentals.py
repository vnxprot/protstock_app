from protstock.fundamentals import _json_safe, _period


def test_json_safe_replaces_provider_nan_with_none():
    assert _json_safe({"metric": float("nan"), "nested": [float("inf"), 2.5]}) == {
        "metric": None,
        "nested": [None, 2.5],
    }


def test_quarter_parser():
    assert _period("2025-Q3") == (2025, 3)
