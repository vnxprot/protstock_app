from __future__ import annotations

from datetime import timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from re import findall
from xml.etree import ElementTree

import httpx

from .config import Settings
from .supabase_rest import SupabaseRestClient

HNX_ISSUER_RSS = "https://www.hnx.vn/3/vi_vn/thong-tin-cong-bo-tu-to-chuc-phat-hanh.rss"


def parse_hnx_rss(xml_text: str, symbols: set[str]) -> list[dict]:
    root = ElementTree.fromstring(xml_text.lstrip("\ufeff"))
    rows = []
    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        published = parsedate_to_datetime(item.findtext("pubDate") or "").astimezone(timezone.utc)
        link, reference = (item.findtext("link") or "").strip(), (item.findtext("guid") or "").strip()
        candidates = [value for value in findall(r"\b[A-Z]{3,10}\b", title) if value in symbols]
        rows.append({"source": "HNX", "source_reference": reference, "title": title, "published_at": published.isoformat(), "available_from": published.date().isoformat(), "source_url": link, "symbol": candidates[0] if candidates else None, "content_hash": sha256(f"{reference}|{title}|{link}".encode()).hexdigest()})
    return rows


def run_hnx_disclosures() -> dict:
    client = SupabaseRestClient(Settings.from_env())
    job = client.create_job({"job_type": "DISCLOSURE_INGEST", "status": "RUNNING", "trigger_type": "SCHEDULED", "source_revision": "hnx-rss-v1"})
    try:
        symbols = {row["symbol"]: row["id"] for row in client.active_symbols()}
        response = httpx.get(HNX_ISSUER_RSS, timeout=30)
        response.raise_for_status()
        parsed = parse_hnx_rss(response.text, set(symbols))
        payload = [{key: value for key, value in row.items() if key not in {"symbol", "content_hash"}} | {"symbol_id": symbols.get(row["symbol"]), "category": "HNX_ISSUER_RSS"} for row in parsed]
        written = client.upsert("disclosures", payload, "source,source_reference")
        client.finish_job(job["id"], {"status": "SUCCEEDED", "finished_at": _now(), "counts": {"disclosures": written}})
        return {"status": "SUCCEEDED", "disclosures": written}
    except Exception as exc:
        client.finish_job(job["id"], {"status": "FAILED", "finished_at": _now(), "error_summary": str(exc)[:500]})
        raise
    finally:
        client.close()


def _now() -> str:
    from datetime import datetime
    return datetime.now(timezone.utc).isoformat()
