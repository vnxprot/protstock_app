from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
import re


SYMBOL_RE = re.compile(r"^[A-Z0-9]{3,10}$")


@dataclass(frozen=True)
class UniverseRow:
    symbol: str
    sector: str
    active: bool = True

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not SYMBOL_RE.fullmatch(self.symbol):
            errors.append("invalid_symbol")
        if not self.sector.strip():
            errors.append("missing_sector")
        return errors


@dataclass(frozen=True)
class DailyBar:
    symbol: str
    trading_date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int
    source: str
    collected_at: datetime

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not SYMBOL_RE.fullmatch(self.symbol):
            errors.append("invalid_symbol")
        if min(self.open, self.high, self.low, self.close) <= 0:
            errors.append("non_positive_price")
        if self.high < max(self.open, self.close, self.low):
            errors.append("high_below_ohlc")
        if self.low > min(self.open, self.close, self.high):
            errors.append("low_above_ohlc")
        if self.volume < 0:
            errors.append("negative_volume")
        if not self.source:
            errors.append("missing_source")
        if self.collected_at.tzinfo is None:
            errors.append("naive_collected_at")
        return errors

    @classmethod
    def create(
        cls,
        *,
        symbol: str,
        trading_date: date,
        open: str | int | float,
        high: str | int | float,
        low: str | int | float,
        close: str | int | float,
        volume: int,
        source: str,
        collected_at: datetime | None = None,
    ) -> "DailyBar":
        return cls(
            symbol=symbol.strip().upper(),
            trading_date=trading_date,
            open=Decimal(str(open)),
            high=Decimal(str(high)),
            low=Decimal(str(low)),
            close=Decimal(str(close)),
            volume=int(volume),
            source=source.strip(),
            collected_at=collected_at or datetime.now(timezone.utc),
        )
