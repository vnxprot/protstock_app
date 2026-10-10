from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from time import sleep
from random import uniform
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

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Only use for reads and idempotent writes; never retry queue claims."""
        for attempt in range(3):
            try:
                response = self._client.request(method, url, **kwargs)
                if response.status_code not in {408, 429, 500, 502, 503, 504} or attempt == 2:
                    return response
                retry_after = response.headers.get("retry-after", "")
                delay = min(float(retry_after), 30) if retry_after.isdigit() else 2 ** attempt
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt == 2:
                    raise
                delay = 2 ** attempt
            sleep(delay + uniform(0, 0.25))
        raise RuntimeError("unreachable")

    def _get(self, url: str, **kwargs) -> httpx.Response:
        return self._request("GET", url, **kwargs)

    def replace_zone_snapshot(self, symbol_id: int, timeframe: str, as_of_date: str, rows: list[dict]) -> int:
        """Upsert first, then deactivate obsolete same-day bounds; preserve history."""
        filters = {"symbol_id": f"eq.{symbol_id}", "timeframe": f"eq.{timeframe}", "as_of_date": f"eq.{as_of_date}"}
        response = self._get("/support_resistance_zones", params={**filters, "select": "id,zone_type,lower_price,upper_price"})
        response.raise_for_status()
        existing = response.json()
        def key(row):
            return row["zone_type"], round(float(row["lower_price"]), 4), round(float(row["upper_price"]), 4)
        count = self.upsert("support_resistance_zones", [{**row, "active": True} for row in rows], "symbol_id,timeframe,as_of_date,zone_type,lower_price,upper_price")
        current = {key(row) for row in rows}
        obsolete = [str(row["id"]) for row in existing if key(row) not in current]
        if obsolete:
            response = self._client.patch("/support_resistance_zones", params={**filters, "id": f"in.({','.join(obsolete)})"}, json={"active": False})
            response.raise_for_status()
        return count

    def replace_pattern_snapshot(self, symbol_id: int, timeframe: str, as_of_date: str, rows: list[dict]) -> int:
        """Refresh one day's pattern evidence and remove superseded geometry."""
        filters = {"symbol_id": f"eq.{symbol_id}", "timeframe": f"eq.{timeframe}", "as_of_date": f"eq.{as_of_date}"}
        count = self.upsert("pattern_instances", rows, "symbol_id,timeframe,pattern_type,start_date,as_of_date,algorithm_version")
        response = self._get("/pattern_instances", params={**filters, "select": "id,pattern_type,start_date,algorithm_version"})
        response.raise_for_status()
        current = {(row["pattern_type"], row["start_date"], row["algorithm_version"]) for row in rows}
        obsolete = [str(row["id"]) for row in response.json() if (row["pattern_type"], row["start_date"], row["algorithm_version"]) not in current]
        if obsolete:
            response = self._client.delete("/pattern_instances", params={**filters, "id": f"in.({','.join(obsolete)})"})
            response.raise_for_status()
        return count

    def close(self) -> None:
        self._client.close()

    def active_symbols(self) -> list[dict[str, Any]]:
        return self._pages("symbols", {"select": "id,symbol,exchange,sector,listed_from", "active": "eq.true", "order": "symbol.asc"})

    def _pages(self, table: str, params: dict, limit: int | None = None) -> list[dict]:
        rows = []
        for offset in range(0, limit or 1_000_000, 1000):
            page_size = min(1000, limit - offset) if limit else 1000
            response = self._get(f"/{table}", params=params, headers={"Range": f"{offset}-{offset + page_size - 1}"})
            response.raise_for_status()
            page = response.json()
            rows.extend(page)
            if len(page) < page_size:
                break
        return rows

    def all_symbols_for_replay(self) -> list[dict[str, Any]]:
        """Keep inactive and delisted symbols in historical research cohorts."""
        response = self._get(
            "/symbols",
            params={"select": "id,symbol,exchange,sector,listed_from,active", "order": "symbol.asc"},
        )
        response.raise_for_status()
        return response.json()

    def symbol_by_id(self, symbol_id: int) -> dict[str, Any]:
        response = self._get("/symbols", params={"select": "id,symbol,exchange,sector,active", "id": f"eq.{symbol_id}", "limit": "1"})
        response.raise_for_status()
        rows = response.json()
        if not rows:
            raise ValueError("Unknown backtest symbol")
        return rows[0]

    def market_index(self, code: str) -> dict[str, Any]:
        response = self._get("/market_indices", params={"select": "id,code", "code": f"eq.{code}", "limit": "1"})
        response.raise_for_status()
        rows = response.json()
        if not rows:
            raise ValueError(f"unknown market index: {code}")
        return rows[0]

    def index_price_history(self, index_id: int, limit: int = 260) -> list[dict[str, Any]]:
        rows = self._pages("market_index_prices", {"select": "trading_date,open,high,low,close,volume", "index_id": f"eq.{index_id}", "order": "trading_date.desc"}, limit)
        return list(reversed(rows))

    def index_price_dates(self, index_id: int, start_date, end_date) -> list[str]:
        return self._date_rows(
            "market_index_prices", [("index_id", f"eq.{index_id}"), ("trading_date", f"gte.{start_date.isoformat()}"), ("trading_date", f"lte.{end_date.isoformat()}")]
        )

    def symbol_price_dates(self, symbol_id: int, start_date, end_date) -> list[str]:
        return self._date_rows(
            "daily_prices", [("symbol_id", f"eq.{symbol_id}"), ("trading_date", f"gte.{start_date.isoformat()}"), ("trading_date", f"lte.{end_date.isoformat()}")]
        )

    def _date_rows(self, table: str, filters: list[tuple[str, str]]) -> list[str]:
        rows: list[dict[str, Any]] = []
        for offset in range(0, 10_000, 1_000):
            for attempt in range(3):
                response = self._get(
                    f"/{table}",
                    params=[("select", "trading_date"), ("order", "trading_date.asc"), *filters],
                    headers={"Range": f"{offset}-{offset + 999}"},
                )
                if response.status_code < 500 or attempt == 2:
                    break
                sleep(attempt + 1)
            response.raise_for_status()
            page = response.json()
            rows.extend(page)
            if len(page) < 1_000:
                break
        return [str(row["trading_date"]) for row in rows]

    def price_history(self, symbol_id: int, limit: int = 260) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page_size = min(1000, limit)
        for offset in range(0, limit, page_size):
            response = self._get(
                "/daily_prices",
                params={"select": "trading_date,open,high,low,close,volume,source,source_version,price_unit,quality_status", "symbol_id": f"eq.{symbol_id}", "order": "trading_date.desc"},
                headers={"Range": f"{offset}-{min(offset + page_size, limit) - 1}"},
            )
            response.raise_for_status()
            page = response.json()
            rows.extend(page)
            if len(page) < page_size:
                break
        return list(reversed(rows))

    def research_price_history(self, symbol_id: int, limit: int = 2600) -> list[dict[str, Any]]:
        """Read one coherent vendor-rebased series for historical research."""
        rows: list[dict[str, Any]] = []
        for offset in range(0, limit, 1000):
            response = self._get(
                "/research_price_bars",
                params={"select": "trading_date,open,high,low,close,volume,volume_basis,volume_adjustment_factor,source,source_url,source_version,price_unit,quality_status,basis",
                        "symbol_id": f"eq.{symbol_id}", "order": "trading_date.desc"},
                headers={"Range": f"{offset}-{min(offset + 1000, limit) - 1}"},
            )
            response.raise_for_status()
            page = response.json()
            rows.extend(page)
            if len(page) < 1000:
                break
        return list(reversed(rows))

    def research_price_status(self, symbol_id: int) -> dict[str, Any] | None:
        response = self._get(
            "/research_price_sync_status",
            params={"select": "coverage_status,source_version,requested_start_date,requested_end_date,first_date,last_date,vendor_bars,unmatched_stored_dates,quarantined_bars",
                    "symbol_id": f"eq.{symbol_id}", "limit": "1"},
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None

    def stock_prices_by_source_and_date(self, source: str, trading_date: date) -> list[dict[str, Any]]:
        response = self._get(
            "/daily_prices",
            params={
                "select": "symbol_id,trading_date,open,high,low,close,volume,source,collected_at,quality_status",
                "source": f"eq.{source}",
                "trading_date": f"eq.{trading_date.isoformat()}",
                "limit": "1000",
            },
        )
        response.raise_for_status()
        return response.json()

    def closed_trading_sessions(self, exchange: str, start_date: date, end_date: date) -> set[date]:
        response = self._get(
            "/trading_sessions",
            params=[("select", "trading_date,is_open"), ("exchange", f"eq.{exchange}"),
                    ("trading_date", f"gte.{start_date.isoformat()}"),
                    ("trading_date", f"lte.{end_date.isoformat()}")],
        )
        response.raise_for_status()
        return {date.fromisoformat(row["trading_date"]) for row in response.json() if row["is_open"] is False}

    def consolidated_signal_count(self, trading_date: date, source_revision: str | None = None) -> int:
        filters = {"select": "id", "as_of_date": f"eq.{trading_date.isoformat()}", "limit": "1"}
        if source_revision:
            filters["source_revision"] = f"eq.{source_revision}"
        response = self._get(
            "/consolidated_signals",
            params=filters,
            headers={"Prefer": "count=exact"},
        )
        response.raise_for_status()
        content_range = response.headers.get("content-range", "")
        if "/" not in content_range or content_range.endswith("/*"):
            raise RuntimeError("Exact published signal count unavailable")
        return int(content_range.rsplit("/", 1)[1])

    def published_signal_revision(self, trading_date: date) -> str | None:
        response = self._get(
            "/job_runs",
            params={"select": "source_revision,counts", "trading_date": f"eq.{trading_date.isoformat()}",
                    "status": "eq.SUCCEEDED", "order": "finished_at.desc", "limit": "20"},
        )
        response.raise_for_status()
        return next((row.get("source_revision") or "legacy" for row in response.json()
                     if (row.get("counts") or {}).get("published_signals") is not None), None)

    def published_signal_dates(self, start_date: date, end_date: date) -> set[date]:
        """Protect authoritative published EOD breadth from historical estimates."""
        dates: set[date] = set()
        for offset in range(0, 10_000, 1_000):
            response = self._get(
                "/job_runs",
                params=[("select", "trading_date,counts"), ("status", "eq.SUCCEEDED"),
                        ("trading_date", f"gte.{start_date.isoformat()}"), ("trading_date", f"lte.{end_date.isoformat()}"),
                        ("order", "trading_date.asc")],
                headers={"Range": f"{offset}-{offset + 999}"},
            )
            response.raise_for_status()
            page = response.json()
            dates.update(date.fromisoformat(row["trading_date"]) for row in page if (row.get("counts") or {}).get("published_signals") is not None)
            if len(page) < 1_000:
                break
        return dates

    def all_daily_prices(self, start_date: date, end_date: date) -> list[dict[str, Any]]:
        """Read stored OHLCV in pages for point-in-time Market Health rebuilds."""
        rows: list[dict[str, Any]] = []
        for offset in range(0, 1_000_000, 1000):
            response = self._get(
                "/daily_prices",
                params=[("select", "symbol_id,trading_date,high,low,close,volume"), ("trading_date", f"gte.{start_date.isoformat()}"), ("trading_date", f"lte.{end_date.isoformat()}"), ("order", "trading_date.asc,symbol_id.asc")],
                headers={"Range": f"{offset}-{offset + 999}"},
            )
            response.raise_for_status()
            page = response.json()
            rows.extend(page)
            if len(page) < 1000:
                break
        return rows

    def index_prices_in_range(self, index_id: int, start_date: date, end_date: date) -> list[dict[str, Any]]:
        """Page the full benchmark history instead of silently truncating 2021+ rebuilds."""
        rows: list[dict[str, Any]] = []
        for offset in range(0, 10_000, 1_000):
            response = self._get(
                "/market_index_prices",
                params=[("select", "trading_date,close"), ("index_id", f"eq.{index_id}"), ("trading_date", f"gte.{start_date.isoformat()}"), ("trading_date", f"lte.{end_date.isoformat()}"), ("order", "trading_date.asc")],
                headers={"Range": f"{offset}-{offset + 999}"},
            )
            response.raise_for_status()
            page = response.json()
            rows.extend(page)
            if len(page) < 1_000:
                break
        return rows

    def active_rule_versions(self) -> list[dict[str, Any]]:
        """Load enabled engines in two explicit queries; avoid fragile embedded filters."""
        rules_response = self._get(
            "/rules",
            params={
                "select": "id,user_id,name,kind,pack_version,notification_mode,blocks_new_entries,status",
                "status": "eq.ACTIVE",
            },
        )
        rules_response.raise_for_status()
        rules = rules_response.json()
        if not rules:
            return []
        rules_by_id = {rule["id"]: rule for rule in rules}
        rule_ids = ",".join(rules_by_id)
        versions_response = self._get(
            "/rule_versions",
            params={"select": "id,rule_id,dsl,version", "rule_id": f"in.({rule_ids})", "order": "version.desc"},
        )
        versions_response.raise_for_status()
        latest = {}
        for version in versions_response.json():
            latest.setdefault(version["rule_id"], version)
        return [
            {"id": version["id"], "dsl": version["dsl"], "rules": rules_by_id[version["rule_id"]]}
            for version in latest.values()
            if version["rule_id"] in rules_by_id
        ]

    def market_breadth_snapshot(self, trading_date) -> dict[str, Any] | None:
        response = self._get(
            "/market_breadth_snapshots",
            params={"select": "trading_date,pct_above_sma50,pct_above_sma20,pct_above_sma200,pct_ma_stack,market_health_score,market_health_state,sample_size,universe_size,eligible_count,observed_count,coverage_ratio,coverage_status,vnindex_trend_state,advance_count,decline_count,unchanged_count,advance_decline_ratio,new_high20_count,new_low20_count,up_volume,down_volume,up_down_volume_ratio,sector_breadth", "trading_date": f"lte.{trading_date.isoformat()}", "coverage_status": "in.(COMPLETE,DEGRADED)", "order": "trading_date.desc", "limit": "1"},
        )
        response.raise_for_status()
        rows = response.json()
        return rows[0] if rows else None

    def latest_daily_snapshot_date_before(self, trading_date) -> date | None:
        response = self._get(
            "/technical_snapshots",
            params={"select": "as_of_date", "timeframe": "eq.D", "as_of_date": f"lt.{trading_date.isoformat()}", "order": "as_of_date.desc", "limit": "1"},
        )
        response.raise_for_status()
        rows = response.json()
        return date.fromisoformat(rows[0]["as_of_date"]) if rows else None

    def daily_snapshots_for_date(self, trading_date) -> list[dict[str, Any]]:
        """One completed daily snapshot per symbol for Fast Lane completion checks."""
        return self._pages("technical_snapshots", {
                "select": "symbol_id,close,sma20,sma50,sma200,ma_stack,last_volume,close_high20,close_low20,flow_score,flow_state,algorithm_version",
                "timeframe": "eq.D",
                "as_of_date": f"eq.{trading_date.isoformat()}",
                "order": "symbol_id.asc",
            })

    def signals_missing_outcomes(self, cutoff_date) -> list[dict[str, Any]]:
        rows = []
        for offset in range(0, 1_000_000, 1000):
            response = self._get("/signals", params={
                "select": "id,symbol_id,as_of_date,action,evidence,signal_outcomes(horizon_days,status,calculation_version,price_fingerprint)",
                "as_of_date": f"lte.{cutoff_date.isoformat()}", "order": "as_of_date.asc,id.asc",
            }, headers={"Range": f"{offset}-{offset + 999}"})
            response.raise_for_status()
            page = response.json()
            rows.extend(page)
            if len(page) < 1000: break
        return rows

    def portfolio_context(self, user_id: str) -> dict:
        response = self._get("/portfolios", params={"select": "id,capital,max_risk_per_trade_pct,positions(symbol_id,quantity,average_cost,stop_price,opened_at,symbols(sector))", "user_id": f"eq.{user_id}", "order": "created_at.asc"})
        response.raise_for_status()
        portfolios = response.json()
        return {"capital": sum(float(p["capital"]) for p in portfolios), "risk_pct": min((float(p["max_risk_per_trade_pct"]) for p in portfolios), default=1), "positions": [position for p in portfolios for position in p.get("positions", [])]}

    def archive_old_pattern_evidence(self, cutoff_date) -> int:
        response = self._client.post(
            "/rpc/archive_old_pattern_evidence",
            json={"p_cutoff_date": cutoff_date.isoformat()},
        )
        response.raise_for_status()
        return len(response.json())

    def queued_backtests(self, limit: int = 3) -> list[dict[str, Any]]:
        response = self._client.post("/rpc/claim_backtest_jobs", json={"p_limit": limit})
        response.raise_for_status()
        rows = response.json()
        for row in rows:
            if row.get("rule_dsl"):
                row["rule_versions"] = {"dsl": row["rule_dsl"]}
            else:
                version = self._get("/rule_versions", params={"select": "dsl", "id": f"eq.{row['rule_version_id']}", "limit": "1"})
                version.raise_for_status()
                row["rule_versions"] = (version.json() or [{}])[0]
        return rows

    def update_backtest(self, run_id: str, payload: dict[str, Any], started_at: str | None = None) -> None:
        params = {"id": f"eq.{run_id}"}
        if started_at:
            params["started_at"] = f"eq.{started_at}"
        response = self._request("PATCH", "/backtest_runs", params=params, headers={"Prefer": "return=representation" if started_at else "return=minimal"}, json=payload)
        response.raise_for_status()
        if started_at and not response.json():
            raise RuntimeError("Backtest lease expired or was claimed by another worker")

    def replace_backtest_trades(self, run_id: str, rows: list[dict], started_at: str | None = None) -> None:
        response = self._request("POST", "/rpc/replace_backtest_trades", json={"p_run_id": run_id, "p_rows": rows, "p_started_at": started_at})
        response.raise_for_status()

    def breadth_history(self, start_date: date, end_date: date) -> list[dict]:
        return self._pages("market_breadth_snapshots", {"select": "*", "trading_date": f"gte.{start_date.isoformat()}", "and": f"(trading_date.lte.{end_date.isoformat()})", "order": "trading_date.asc"})

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
        response = self._request("POST",
            f"/{table}",
            params={"on_conflict": on_conflict},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=payload,
        )
        response.raise_for_status()
        return len(payload)

    def upsert_core_engine_signal(self, payload: dict[str, Any]) -> int:
        """Write the one canonical Core Engine decision for a symbol/date/frame.

        The database function owns the partial-index conflict predicate. PostgREST's
        generic ``on_conflict`` parameter cannot express that predicate safely.
        """
        response = self._client.post(
            "/rpc/upsert_core_engine_signal",
            headers={"Prefer": "return=minimal"},
            json={
                "p_symbol_id": payload["symbol_id"],
                "p_timeframe": payload["timeframe"],
                "p_as_of_date": payload["as_of_date"],
                "p_action": payload["action"],
                "p_score": payload["score"],
                "p_reasons": payload["reasons"],
                "p_evidence": payload["evidence"],
            },
        )
        response.raise_for_status()
        return 1

    def delete_consolidated_signal(self, symbol_id: int, timeframe: str, as_of_date: str) -> None:
        """Remove a current resolved result when every enabled engine is silent."""
        response = self._client.delete(
            "/consolidated_signals",
            params={"symbol_id": f"eq.{symbol_id}", "timeframe": f"eq.{timeframe}", "as_of_date": f"eq.{as_of_date}"},
        )
        response.raise_for_status()

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        from datetime import datetime, timezone
        payload = {**payload, "heartbeat_at": datetime.now(timezone.utc).isoformat()}
        response = self._client.post(
            "/job_runs",
            headers={"Prefer": "return=representation"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()[0]

    def heartbeat_job(self, job_id: str) -> None:
        from datetime import datetime, timezone
        response = self._request("PATCH", "/job_runs", params={"id": f"eq.{job_id}"}, json={"heartbeat_at": datetime.now(timezone.utc).isoformat()}, headers={"Prefer": "return=minimal"})
        response.raise_for_status()

    def finish_job(self, job_id: str, payload: dict[str, Any]) -> None:
        response = self._client.patch(
            "/job_runs",
            params={"id": f"eq.{job_id}"},
            headers={"Prefer": "return=minimal"},
            json=payload,
        )
        response.raise_for_status()
