from __future__ import annotations

import csv
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

from .models import UniverseRow


# Prot's industry groups are the canonical vocabulary for both trading and
# market observation. New listings need an explicit classification.
PROT_SECTORS = frozenset({
    "BAN LE", "BAO HIEM", "BDS", "BDS_KCN", "BE TONG_NHUA DUONG", "CANG BIEN",
    "CAO SU", "CHUNG KHOAN", "DAU KHI", "DAU TU CONG", "DIEN_NUOC", "DUOC",
    "DUONG", "GAO", "GIAY_BAO BI", "GO", "HANG KHONG", "HOA CHAT_PHAN BON",
    "KHOANG SAN", "NGAN HANG", "THAN", "THEP", "THUC PHAM", "THUY SAN",
    "VIETTEL", "XAY DUNG", "XUAT KHAU", "CONG NGHE", "DU LICH_GIAI TRI",
    "VAN TAI CONG NGHIEP", "CHAN NUOI",
})


@dataclass(frozen=True)
class UniverseValidation:
    rows: tuple[UniverseRow, ...]
    duplicates: tuple[str, ...]
    invalid: tuple[tuple[int, tuple[str, ...]], ...]
    sha256: str

    @property
    def is_valid(self) -> bool:
        return not self.duplicates and not self.invalid


def load_universe(path: str | Path) -> UniverseValidation:
    csv_path = Path(path)
    payload = csv_path.read_bytes()
    rows: list[UniverseRow] = []
    invalid: list[tuple[int, tuple[str, ...]]] = []
    seen: set[str] = set()
    duplicates: set[str] = set()

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"symbol", "company_name", "sector", "exchange", "trading_status", "active"}
        if set(reader.fieldnames or ()) != required:
            raise ValueError(f"Expected CSV headers {sorted(required)}")

        for row_number, raw in enumerate(reader, start=2):
            symbol = (raw.get("symbol") or "").strip().upper()
            active_text = (raw.get("active") or "").strip().lower()
            parsed = UniverseRow(
                symbol=symbol,
                sector=(raw.get("sector") or "").strip(),
                active=active_text in {"true", "1", "yes"},
                company_name=(raw.get("company_name") or "").strip(),
                exchange=(raw.get("exchange") or "UNKNOWN").strip().upper(),
                trading_status=(raw.get("trading_status") or "UNKNOWN").strip().upper(),
            )
            errors = parsed.validate()
            if parsed.sector not in PROT_SECTORS:
                errors.append("unknown_sector")
            if active_text not in {"true", "false", "1", "0", "yes", "no"}:
                errors.append("invalid_active")
            if symbol in seen:
                duplicates.add(symbol)
            seen.add(symbol)
            if errors:
                invalid.append((row_number, tuple(errors)))
            rows.append(parsed)

    return UniverseValidation(
        rows=tuple(rows),
        duplicates=tuple(sorted(duplicates)),
        invalid=tuple(invalid),
        sha256=sha256(payload).hexdigest(),
    )
