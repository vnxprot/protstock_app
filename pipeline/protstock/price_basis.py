"""Use each vendor's reported OHLCV as one coherent calculation series."""

from __future__ import annotations

from datetime import date
from hashlib import sha256
from json import dumps
from typing import Iterable

from .models import DailyBar
from .provider_market import KBS_SOURCE_VERSION, STOCK_PRICE_UNIT, VCI_SOURCE_VERSION


def source_family(source: str | None) -> str:
    value = (source or "").upper()
    if value.startswith("VCI_"):
        return "VCI"
    if value.startswith("KBS"):
        return "KBS"
    return "UNKNOWN"


def vendor_revision(family: str) -> str:
    """Price identity describes the vendor contract, not its Python client version."""
    return sha256(dumps([family, "VENDOR_OHLCV_V1"], sort_keys=True).encode()).hexdigest()


def normalized_vendor_revision(row: dict) -> str | None:
    family = source_family(row.get("source"))
    revision = row.get("data_revision")
    legacy = sha256(dumps([family, row.get("source"), "VENDOR_OHLCV"], sort_keys=True).encode()).hexdigest()
    if family != "UNKNOWN" and row.get("price_basis") == "VENDOR_CORPORATE_ACTION_ADJUSTED" and revision in {legacy, vendor_revision(family)}:
        return vendor_revision(family)
    return revision


def volume_window_is_comparable(rows: Iterable[dict]) -> bool:
    """Confirm that a volume window has one reported-volume basis."""
    segments = set()
    for row in rows:
        segment = _volume_segment(row)
        if segment is None:
            return False
        segments.add(segment)
    return len(segments) <= 1


def comparable_volume_suffix(rows: Iterable[dict]) -> list[dict]:
    """Keep the latest contiguous volume segment for volume based research."""
    ordered = list(rows)
    if not ordered:
        return []
    segment = _volume_segment(ordered[-1])
    if segment is None:
        return []
    for start in range(len(ordered) - 1, -1, -1):
        if _volume_segment(ordered[start]) != segment:
            return ordered[start + 1:]
    return ordered


def _volume_segment(row: dict) -> str | None:
    basis = str(row.get("volume_basis") or "VENDOR_REPORTED")
    if basis.startswith("MIXED_UNVERIFIED_VOLUME"):
        return None
    if basis.startswith("UNVERIFIED_SHARE_EVENT") or basis == "LEGACY_UNVERIFIED":
        return basis
    return "VERIFIED_OR_VENDOR_REPORTED"


def with_volume_segments(rows: Iterable[dict], events: Iterable[dict], *, as_of_date: date) -> list[dict]:
    """Read stored vendor volume directly, including rows from older imports.

    Corporate-action records are useful elsewhere, but they do not gate EOD
    analysis or apply an independently inferred factor to vendor OHLCV.
    """
    output = []
    for row in rows:
        if row.get("price_basis") not in {None, "VENDOR_CORPORATE_ACTION_ADJUSTED"}:
            output.append(dict(row))
            continue
        output.append({**row, "volume": int(row.get("source_volume") if row.get("source_volume") is not None else row.get("volume") or 0),
                       "volume_basis": "VENDOR_REPORTED"})
    return output


def price_row_usable(row: dict) -> bool:
    status = row.get("quality_status", "VALID")
    return status == "VALID" or (
        status == "WARNING"
        and row.get("price_basis") == "VENDOR_CORPORATE_ACTION_ADJUSTED"
        and bool(row.get("data_revision"))
    )


def canonical_price_rows(symbol_id: int, bars: Iterable[DailyBar], events: Iterable[dict],
                         *, as_of_date: date) -> list[dict]:
    """Accept vendor OHLCV as reported; never infer another adjustment."""
    rows = []
    for bar in bars:
        family = source_family(bar.source)
        if family == "UNKNOWN":
            raise ValueError(f"Unknown OHLCV source: {bar.source}")
        # A direct-source refresh is a complete validated window. Keep omitted
        # legacy SDK rows for audit without admitting them into that window.
        revision = (sha256(dumps([family, "DIRECT_PUBLIC_OHLCV_V1"], sort_keys=True).encode()).hexdigest()
                    if bar.source.startswith("VCI_DIRECT") else vendor_revision(family))
        rows.append({
            "symbol_id": symbol_id, "trading_date": bar.trading_date.isoformat(),
            "open": float(bar.open), "high": float(bar.high), "low": float(bar.low), "close": float(bar.close),
            "volume": bar.volume, "source_volume": bar.volume,
            "volume_adjustment_factor": 1.0,
            "volume_basis": "VENDOR_REPORTED",
            "price_basis": "VENDOR_CORPORATE_ACTION_ADJUSTED",
            "source": bar.source, "source_version": VCI_SOURCE_VERSION if family == "VCI" else KBS_SOURCE_VERSION,
            "price_unit": STOCK_PRICE_UNIT, "collected_at": bar.collected_at.isoformat(),
            "quality_status": "VALID", "data_revision": revision,
        })
    return rows


def same_source_window(rows: Iterable[dict]) -> bool:
    """Reject windows assembled from multiple vendor/basis revisions."""
    rows = list(rows)
    families = {source_family(row.get("source")) for row in rows}
    revisions = {normalized_vendor_revision(row) for row in rows}
    return len(families) == 1 and "UNKNOWN" not in families and len(revisions) == 1 and None not in revisions


def latest_coherent_revision(rows: Iterable[dict]) -> list[dict]:
    """Use only bars matching the newest vendor revision, even across old gaps."""
    ordered = sorted(rows, key=lambda row: str(row.get("trading_date") or row.get("date")))
    if not ordered:
        return []
    latest = ordered[-1]
    family = source_family(latest.get("source"))
    revision = normalized_vendor_revision(latest)
    basis = latest.get("price_basis")
    if family == "UNKNOWN" or not revision or basis != "VENDOR_CORPORATE_ACTION_ADJUSTED":
        return []
    return [{**row, "data_revision": revision} for row in ordered
            if source_family(row.get("source")) == family
            and normalized_vendor_revision(row) == revision
            and row.get("price_basis") == basis
            and price_row_usable(row)]
