from protstock.disclosures import parse_hnx_rss


def test_hnx_rss_preserves_source_timestamp_and_symbol() -> None:
    xml = '<rss><channel><item><guid>1</guid><title>ABC Báo cáo tài chính</title><link>https://hnx.vn/a</link><pubDate>Wed, 09 Sep 2026 22:41:51 +0700</pubDate></item></channel></rss>'
    row = parse_hnx_rss(xml, {"ABC"})[0]
    assert row["symbol"] == "ABC"
    assert row["available_from"] == "2026-09-09"
    assert row["source_reference"] == "1"
