from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import httpx

from .config import Settings


class SupabaseRestClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self._client = httpx.Client(
            base_url=f"{settings.supabase_url}/rest/v1",
            headers={
                "apikey": settings.service_role_key,
                "Authorization": f"Bearer {settings.service_role_key}",
                "Content-Type": "application/json",
            },
            timeout=settings.timeout_seconds,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def active_symbols(self) -> list[dict[str, Any]]:
        response = self._client.get(
            "/symbols",
            params={"select": "id,symbol,exchange,sector", "active": "eq.true", "order": "symbol.asc"},
        )
        response.raise_for_status()
        return response.json()

    def market_index(self, code: str) -> dict[str, Any]:
        response = self._client.get("/market_indices", params={"select": "id,code", "code": f"eq.{code}", "limit": "1"})
        response.raise_for_status()
        rows = response.json()
        if not rows:
            raise ValueError(f"unknown market index: {code}")
        return rows[0]

    def index_price_history(self, index_id: int, limit: int = 260) -> list[dict[str, Any]]:
        response = self._client.get(
            "/market_index_prices",
            params={"select": "trading_date,open,high,low,close,volume", "index_id": f"eq.{index_id}", "order": "trading_date.desc", "limit": str(limit)},
        )
        response.raise_for_status()
        return list(reversed(response.json()))

    def price_history(self, symbol_id: int, limit: int = 260) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page_size = min(1000, limit)
        for offset in range(0, limit, page_size):
            response = self._client.get(
                "/daily_prices",
                params={"select": "trading_date,open,high,low,close,volume", "symbol_id": f"eq.{symbol_id}", "order": "trading_date.desc"},
                headers={"Range": f"{offset}-{min(offset + page_size, limit) - 1}"},
            )
            response.raise_for_status()
            page = response.json()
            rows.extend(page)
            if len(page) < page_size:
                break
        return list(reversed(rows))

    def active_rule_versions(self) -> list[dict[str, Any]]:
        response = self._client.get(
            "/rule_versions",
            params={
                "select": "id,dsl,rules!inner(status)",
                "rules.status": "eq.ACTIVE",
            },
        )
        response.raise_for_status()
        return response.json()

    def queued_backtests(self, limit: int = 3) -> list[dict[str, Any]]:
        response = self._client.get("/backtest_runs", params={"select": "id,symbol_id,timeframe,date_from,date_to,assumptions,rule_versions(dsl)", "status": "eq.QUEUED", "order": "created_at.asc", "limit": str(limit)})
        response.raise_for_status()
        return response.json()

    def update_backtest(self, run_id: str, payload: dict[str, Any]) -> None:
        response = self._client.patch(f"/backtest_runs?id=eq.{run_id}", headers={"Prefer": "return=minimal"}, json=payload)
        response.raise_for_status()

    def create_job_item(self, payload: dict[str, Any]) -> None:
        response = self._client.post(
            "/job_run_items",
            headers={"Prefer": "return=minimal"},
            json=payload,
        )
        response.raise_for_status()

    def upsert(self, table: str, rows: Iterable[dict[str, Any]], on_conflict: str) -> int:
        payload = list(rows)
        if not payload:
            return 0
        response = self._client.post(
            f"/{table}",
            params={"on_conflict": on_conflict},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=payload,
        )
        response.raise_for_status()
        return len(payload)

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._client.post(
            "/job_runs",
            headers={"Prefer": "return=representation"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()[0]

    def finish_job(self, job_id: str, payload: dict[str, Any]) -> None:
        response = self._client.patch(
            "/job_runs",
            params={"id": f"eq.{job_id}"},
            headers={"Prefer": "return=minimal"},
            json=payload,
        )
        response.raise_for_status()
