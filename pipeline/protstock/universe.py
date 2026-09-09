from __future__ import annotations

import csv
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

from .models import UniverseRow


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
        required = {"symbol", "sector", "active"}
        if set(reader.fieldnames or ()) != required:
            raise ValueError(f"Expected CSV headers {sorted(required)}")

        for row_number, raw in enumerate(reader, start=2):
            symbol = (raw.get("symbol") or "").strip().upper()
            active_text = (raw.get("active") or "").strip().lower()
            parsed = UniverseRow(
                symbol=symbol,
                sector=(raw.get("sector") or "").strip(),
                active=active_text in {"true", "1", "yes"},
            )
            errors = parsed.validate()
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
