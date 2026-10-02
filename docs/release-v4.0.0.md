# Prot Stock v4.0.0

Release scope: personal Windows/iPhone web application. Backup remains outside this release at the user's request.

## UI and daily workflow

- Windows retains all authorized tools. iPhone prioritizes Overview, Watchlist and Journal; account, theme, logout and other tools remain accessible.
- Account-specific query caches and personal draft/outbox namespaces prevent data mixing between signed-in users. Thesis/Watchlist writes pin the expected owner; financial and journal writes enforce ownership in the database.
- System fonts remove a remote font dependency. Zoom, readable labels, focus states, dialog keyboard handling, reduced motion and safe-area spacing improve accessibility.
- Command search resolves actual symbols and permitted functions. The former fixed-template “AI” view is now explicitly a reading guide.
- Loading, absent data, failed requests, partial publications and legacy coverage are distinguished. No empty 0/0 state is presented as complete.
- Analysis initially loads a bounded history, with an explicit full-history action. Market Health exposes valid sample coverage for each component and warns about small sector samples.

## Business rules and decision history

- Core backtests use the same dispatcher, pattern context, reconciliation and safety policy as live analysis. Empty/unknown DSL cannot silently become a buy rule.
- Signals evaluate closed data; simulated orders fill at the next session open. Cash, quantity, cost, fees and PnL use VND; daily stock OHLC remains canonical thousand VND/share internally.
- Warm-up precedes the requested test interval. Date boundaries, closed W/M periods, ADD/REDUCE/EXIT, board lots, gaps and risk limits are handled explicitly.
- Rule editing appends a new version. Hashes are generated from stored JSON by the database. Core Pack names v0/v1/v2 remain conceptual identifiers; implementation revision becomes v4.0.0.
- Investment thesis versions record rationale, catalysts, invalidation, risk and review status. A save detects edits made on another device rather than silently overwriting them. Existing Watchlist On/Off, rationale and price plans remain available; unsaved Board fields persist per account and resist overwrite by synchronization responses.
- Journal stores evidence as of the decision date and links the exact thesis version. Historical snapshots are immutable; old entries without captured evidence remain honestly empty.
- Portfolio history replays trades and capital flows in order, uses weighted average cost, reports missing/stale marks and separates contributions from investment returns.

## Database and operations

- Additive migrations: `20261002030000_v4_integrity_and_queries.sql` and `20261002040000_v4_investment_theses.sql`; existing production migrations remain unchanged.
- Capital and trade RPCs lock the portfolio and accept idempotent request IDs. Ownership, active membership and existing role requirements are enforced.
- Report and analysis RPCs aggregate complete histories beyond the REST row cap. Screener filtering/pagination moves to SQL; sparklines fetch recent sessions per symbol.
- EOD uses balanced active-universe shards, missing-symbol retries, a daily retry bound, heartbeats and COMPLETE/PARTIAL coverage/revision checks.
- Stored/historical rebuilds require prices on the exact requested session; missing prices never count as covered. Prepared analyses must belong to that same session. Long rebuilds report progress to stderr while preserving the CLI JSON response.
- Fast Lane: 15:30 Vietnam time. Supabase watchdog: existing 15:35; GitHub watchdog: 16:15 and 16:45. Backtest worker: 16:00/16:30 and after EOD finalization. Scheduled services can start later because of provider queues.
- KBS is labeled as the actual source; the former VCI selection did not invoke an independent provider and is removed.
- Service worker falls back to HTML only for navigation. Failed API requests never receive the cached app shell, and personal API data is not cached there.

## Validation

- Production TypeScript/Vite build passed against the latest production base; 260 Python tests and 43 JavaScript tests passed.
- Python regression suite: dispatcher, parser parity, cash/units/chronology, gap sizing, warm-up, worker leases, health coverage, ingestion recovery and REST behavior.
- JavaScript tests: sector history, signal triage, Watchlist persistence/restart/replay/account isolation, chronological portfolio ledger, historical journal evidence, Vietnam calendar dates and service-worker API isolation.
- PostgreSQL-compatible PGlite migration smoke tests: eight groups covering all application migrations, atomic/idempotent capital/trades, RLS, expected-owner checks, future dates, histories above 1000 rows, rule hashes/versions, backtest snapshots/leases and thesis/journal history.
- Browser verification: eleven workspaces at 393/760/1024/1440 px (44 layout checks); mobile navigation, account/logout availability and role restrictions. Populated fixtures also verify thesis versions, pending-save protection, iPhone quick journal, Watchlist Board drafts and retained Off rows.

## Remaining limits

No new recurring paid service is introduced. Free infrastructure and source rate limits do not guarantee unlimited capacity. Corporate-action collection is incomplete; historical sector labels are not a point-in-time classification history. Portfolio reports currently exclude trading fees/taxes unless separately recorded; backtest assumptions include configured costs. Backtests use EOD/next-open execution and do not yet simulate intraday fills or T+2 settlement restrictions. Scores and Flow indicators are condition measures, not probabilities or identified net investor flows. Backup is intentionally excluded.

## Deployment order

1. Commit v4 to `codex/v4.0.0`; run CI and preview.
2. Review the production database dry-run with bootstrap/reconciliation disabled.
3. Apply only the additive v4 migrations and verify schema.
4. Fast-forward `main`; verify the Vercel production deployment and release version.
5. Rebuild stored EOD signals with Telegram disabled, so new results carry the actual v4 revision.
