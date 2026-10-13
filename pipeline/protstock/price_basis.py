"""Vendor price provenance and honest volume comparability boundaries.

VCI/KBS OHLCV is accepted as reported. An event without a proven vendor
volume policy separates volume windows; it never invalidates price history.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from json import dumps
from typing import Iterable

from .models import DailyBar
from .provider_vnstock import KBS_SOURCE_VERSION, STOCK_PRICE_UNIT, VCI_SOURCE_VERSION


SHARE_ACTIONS = frozenset({"STOCK_DIVIDEND", "BONUS", "SPLIT"})
VERIFIED_STATUSES = frozenset({"VERIFIED", "OFFICIAL"})


def factor_is_verified(event: dict) -> bool:
    return (event.get("verification_status") in VERIFIED_STATUSES
            and (event.get("metadata") or {}).get("volume_policy") == "UNADJUSTED_PRE_EVENT")


def distinct_share_events(events: Iterable[dict]) -> list[dict]:
    """Merge vendor and official descriptions of the same entitlement."""
    priority = {"OFFICIAL": 3, "VERIFIED": 2, "SOURCE_REPORTED": 1}
    chosen: dict[tuple[str, str], dict] = {}
    for event in events:
        if event.get("action_type") not in SHARE_ACTIONS or not event.get("ex_date"):
            continue
        key = (str(event["action_type"]), str(event["ex_date"])[:10])
        previous = chosen.get(key)
        if previous is None or priority.get(event.get("verification_status"), 0) > priority.get(previous.get("verification_status"), 0):
            chosen[key] = event
        elif previous and priority.get(event.get("verification_status"), 0) == priority.get(previous.get("verification_status"), 0):
            if str(event.get("ratio")) != str(previous.get("ratio")):
                if event.get("verification_status") in VERIFIED_STATUSES:
                    raise ValueError(f"Conflicting verified share-event ratios: {key}")
                # Two vendor descriptions with different ratios are still
                # unverified. Keep the bars for audit and quarantine the
                # pre-event window instead of blocking the entire import.
    return [chosen[key] for key in sorted(chosen)]


def source_family(source: str | None) -> str:
    value = (source or "").upper()
    if value.startswith("VCI_"):
        return "VCI"
    if value.startswith("KBS"):
        return "KBS"
    return "UNKNOWN"


def volume_factor_for_day(day: date, events: Iterable[dict]) -> Decimal:
    """Return the post-event share equivalent of one old traded share."""
    factor = Decimal(1)
    for event in events:
        if event.get("action_type") not in SHARE_ACTIONS:
            continue
        if not factor_is_verified(event):
            continue
        ex_date = date.fromisoformat(str(event["ex_date"])[:10])
        if day >= ex_date:
            continue
        ratio = Decimal(str(event.get("ratio") or 0))
        if ratio <= 0:
            raise ValueError("Verified share event has no positive ratio")
        factor *= (1 + ratio) if event["action_type"] in {"STOCK_DIVIDEND", "BONUS"} else ratio
    return factor


def volume_window_is_comparable(rows: Iterable[dict]) -> bool:
    """A volume ratio/flow window may not cross an unresolved share event."""
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
    """Date the volume boundaries of stored v0.0.0 bars without rewriting them."""
    actions = [event for event in events if event.get("ex_date")
               and date.fromisoformat(str(event["ex_date"])[:10]) <= as_of_date]
    share_events = distinct_share_events(actions)
    output = []
    for row in rows:
        if row.get("price_basis") not in {None, "VENDOR_CORPORATE_ACTION_ADJUSTED"}:
            output.append(dict(row))
            continue
        day = date.fromisoformat(str(row.get("trading_date") or row.get("date"))[:10])
        pending = [item for item in share_events if not factor_is_verified(item)
                   and day < date.fromisoformat(str(item["ex_date"])[:10])]
        pending.extend(item for item in actions if item.get("action_type") in {"RIGHTS_ISSUE", "OTHER"}
                       and item.get("verification_status") != "REJECTED"
                       and (item.get("metadata") or {}).get("entitlement_policy") != "NO_EXISTING_HOLDER_ENTITLEMENT"
                       and day < date.fromisoformat(str(item["ex_date"])[:10]))
        boundary = min((str(item["ex_date"])[:10] for item in pending), default=None)
        basis = (f"UNVERIFIED_SHARE_EVENT:{boundary}" if boundary else
                 "VERIFIED_SHARE_REBASED" if float(row.get("volume_adjustment_factor") or 1) != 1 else
                 "VENDOR_REPORTED")
        output.append({**row, "volume_basis": basis})
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
    """Build canonical EOD rows without claiming that vendor price factors are known."""
    actions = [event for event in events if event.get("ex_date")
               and date.fromisoformat(str(event["ex_date"])[:10]) <= as_of_date]
    share_events = distinct_share_events(actions)
    rows = []
    for bar in bars:
        family = source_family(bar.source)
        if family == "UNKNOWN":
            raise ValueError(f"Unknown OHLCV source: {bar.source}")
        factor = volume_factor_for_day(bar.trading_date, share_events)
        pending = [item for item in share_events if not factor_is_verified(item)
                   and bar.trading_date < date.fromisoformat(str(item["ex_date"])[:10])]
        pending.extend(item for item in actions if item.get("action_type") in {"RIGHTS_ISSUE", "OTHER"}
                       and item.get("verification_status") != "REJECTED"
                       and (item.get("metadata") or {}).get("entitlement_policy") != "NO_EXISTING_HOLDER_ENTITLEMENT"
                       and bar.trading_date < date.fromisoformat(str(item["ex_date"])[:10]))
        boundary = min((str(item["ex_date"])[:10] for item in pending), default=None)
        adjusted_volume = int((Decimal(bar.volume) * factor).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        event_fingerprint = sorted((item.get("action_type"), str(item.get("ex_date")), str(item.get("ratio")),
                                    str(item.get("cash_amount")), str(item.get("verification_status")),
                                    str((item.get("metadata") or {}).get("volume_policy")),
                                    str((item.get("metadata") or {}).get("entitlement_policy"))) for item in actions)
        revision = sha256(dumps([family, bar.source, event_fingerprint], sort_keys=True).encode()).hexdigest()
        rows.append({
            "symbol_id": symbol_id, "trading_date": bar.trading_date.isoformat(),
            "open": float(bar.open), "high": float(bar.high), "low": float(bar.low), "close": float(bar.close),
            "volume": adjusted_volume, "source_volume": bar.volume,
            "volume_adjustment_factor": float(factor),
            "volume_basis": (f"UNVERIFIED_SHARE_EVENT:{boundary}" if boundary else
                             "VERIFIED_SHARE_REBASED" if factor != 1 else "VENDOR_REPORTED"),
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
    revisions = {row.get("data_revision") for row in rows}
    return len(families) == 1 and "UNKNOWN" not in families and len(revisions) == 1 and None not in revisions
