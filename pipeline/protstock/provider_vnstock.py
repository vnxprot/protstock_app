from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from .models import DailyBar


class VnstockProvider:
    """Thin adapter around the optional community vnstock package."""

    def __init__(self, source: str = "KBS") -> None:
        self.source = source.upper()

    def history(self, symbol: str, start: date, end: date) -> list[DailyBar]:
        try:
            from vnstock import Quote
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("Install the data extra: pip install -e '.[data]'") from exc
        frame = Quote(symbol=symbol, source=self.source).history(
            start=start.isoformat(), end=end.isoformat(), interval="1D"
        )
        if frame is None or frame.empty:
            return []
        rows: list[DailyBar] = []
        collected_at = datetime.now(timezone.utc)
        for record in frame.to_dict(orient="records"):
            trading_day = _to_date(record.get("time") or record.get("date") or record.get("trading_date"))
            bar = DailyBar.create(
                symbol=symbol, trading_date=trading_day,
                open=_number(record, "open"), high=_number(record, "high"),
                low=_number(record, "low"), close=_number(record, "close"),
                volume=int(_number(record, "volume", default=0)),
                source=f"VNSTOCK_{self.source}", collected_at=collected_at,
            )
            if not bar.validate():
                rows.append(bar)
        return rows


def _number(record: dict[str, Any], key: str, default: float | None = None) -> float:
    value = record.get(key, default)
    if value is None:
        raise ValueError(f"missing {key}")
    return float(value)


def _to_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])

