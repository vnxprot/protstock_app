from protstock.resolution import resolve_consolidated_signal


def test_resolution_prioritizes_exit_over_conflicting_buy() -> None:
    result = resolve_consolidated_signal([
        {"action": "PROBE_BUY", "engine": "Core v2", "reasons": ["BREAKOUT"]},
        {"action": "EXIT", "engine": "Risk Pack", "reasons": ["INVALIDATION_BROKEN"]},
    ])
    assert result == {
        "composite_action": "EXIT", "confluence_score": 70, "confluence_count": 1,
        "confluence_badge": "STANDARD", "consensus_engines": ["Risk Pack"],
        "reasons": ["INVALIDATION_BROKEN"],
    }


def test_resolution_scores_only_engines_aligned_with_winning_action() -> None:
    result = resolve_consolidated_signal([
        {"action": "ADD", "engine": "Core v2", "reasons": ["BREAKOUT"]},
        {"action": "ADD", "engine": "VCP", "reasons": ["VOLUME"]},
        {"action": "PROBE_BUY", "engine": "Pullback", "reasons": ["EMA20"]},
    ])
    assert result["composite_action"] == "ADD"
    assert result["confluence_score"] == 90
    assert result["confluence_count"] == 2
    assert result["confluence_badge"] == "HIGH_CONFLUENCE"
    assert result["consensus_engines"] == ["Core v2", "VCP"]


def test_resolution_three_aligned_engines_are_strongly_aligned() -> None:
    result = resolve_consolidated_signal([
        {"action": "PROBE_BUY", "engine": engine, "reasons": []}
        for engine in ("Core v2", "VCP", "RS Leader")
    ])
    assert (result["confluence_score"], result["confluence_count"], result["confluence_badge"]) == (98, 3, "STRONG_ALIGNED")
