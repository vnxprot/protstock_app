# Phase 0 technical specification

Status: Draft for implementation  
Product owner: Prot  
Scope: Single-user, personal, non-commercial PWA

## 1. Locked decisions

- The initial universe contains 205 unique Vietnamese stock symbols.
- TDC has exactly one sector label: `BDS_KCN`.
- Prot can add, update, deactivate, or re-import symbols later.
- The system runs after the afternoon trading session; real-time data is out of scope.
- Canonical market storage is daily OHLCV. Weekly and monthly bars are derived from daily bars.
- Official disclosures must retain their publication timestamp and point-in-time availability.
- Signals come from deterministic, versioned rules.
- Natural-language rules are translated to a restricted DSL and require explicit activation by Prot.
- Supabase provides Postgres and authentication.
- GitHub Actions runs scheduled ingestion and analysis.
- Vercel hosts the PWA and small server-side endpoints.

## 2. Explicit non-goals

- Multi-user support.
- Commercial redistribution of market data.
- Real-time prices or order books.
- Automated order placement.
- Social feeds and general news aggregation.
- Unbounded AI-generated code, SQL, or trading rules.
- Machine-learning price prediction in the initial phases.

## 3. Product navigation

The application has four primary destinations:

1. **Today** — market regime, new signals, forming patterns, sector strength, and data health.
2. **Stocks** — universe, screener, and per-symbol analysis.
3. **Strategy** — rule builder, natural-language rules, versions, and backtests.
4. **Portfolio** — positions, risk, transactions, and journal.

Universe management, data-source health, notifications, and account controls live in Settings.

## 4. System architecture

### Web application

- React, Vite, and TypeScript.
- Installable PWA with a web app manifest and service worker.
- TanStack Query for server state.
- Supabase client using the publishable key only.
- Lightweight Charts for candles and overlays.
- IndexedDB caches the latest viewed symbols and completed analysis.

### Batch analysis

- Python batch package executed by GitHub Actions.
- One idempotent scheduled workflow on Vietnamese trading weekdays.
- Default scheduled start: 16:15 Asia/Ho_Chi_Minh (09:15 UTC).
- Manual workflow dispatch is always available.
- The workflow may retry unavailable upstream data without duplicating rows or signals.

### Server-side endpoints

- Vercel Functions are limited to operations that require secrets, such as optional AI text-to-rule conversion.
- Long-running ingestion and full-universe analysis do not run in Vercel Functions.

## 5. Daily processing contract

Each run uses one `trading_date` and follows this order:

1. Load active universe.
2. Fetch the completed daily OHLCV bar for every active symbol and benchmark index.
3. Normalize numeric units, timezone, exchange codes, and missing values.
4. Validate completeness, duplicate keys, impossible prices, and negative volumes.
5. Apply or refresh corporate-action adjustment factors.
6. Upsert canonical daily bars.
7. Derive completed weekly and monthly bars.
8. Collect new official disclosures and determine point-in-time availability.
9. Calculate indicators, relative strength, support/resistance, and pattern candidates.
10. Evaluate active rule versions.
11. Persist signals with an immutable evidence snapshot.
12. Update signal outcomes whose evaluation horizons have matured.
13. Send eligible notifications.
14. Close the job run with counts, warnings, and errors.

The unique key for daily prices is `(symbol_id, trading_date)`. Re-running a date updates the same record.

## 6. Multi-timeframe rules

- Daily OHLCV is the canonical source.
- Weekly periods follow Vietnamese market weeks and close on the final trading session of the week.
- Monthly periods close on the final trading session of the calendar month.
- Bars carry `is_complete`.
- A forming week or month can appear in the UI but cannot enter a default backtest or confirmed signal.
- Default analytical hierarchy:
  - Month: structural trend and major regime.
  - Week: setup and price pattern.
  - Day: trigger, entry evidence, and invalidation.

## 7. Disclosure point-in-time policy

Required fields:

- `published_at`: timestamp displayed by the official source.
- `collected_at`: timestamp when the application observed the disclosure.
- `available_from`: first trading session on which a backtest may use the information.
- `reporting_period`: period described by the document; never used as the availability date.
- `source_url`, `source`, and `content_hash`.

Baseline rule: because analysis runs after market close, a disclosure collected for date T can affect signals for the next eligible session, not an entry at the close of T.

If the source replaces a document, create a new version with a new content hash. Do not overwrite the old point-in-time record.

## 8. Universe lifecycle

The seed file is `data/universe.csv`. It is imported once and remains an auditable source.

Supported updates:

- Add one symbol manually.
- Add multiple symbols by paste.
- Import CSV or Excel.
- Change metadata or sector.
- Deactivate a symbol without deleting history.
- Reactivate a symbol.

Every import produces a dry-run diff:

- new symbols;
- metadata changes;
- symbols missing from the new file;
- duplicates;
- invalid or unsupported symbols.

No change is applied until Prot confirms the diff. Missing symbols default to `no change`; deactivation is a separate explicit option.

## 9. Rule DSL safety model

A rule definition contains:

- universe filters;
- timeframe and completed-bar requirement;
- nested `all`, `any`, and `not` groups;
- indicator or pattern operands;
- comparison, crossing, range, ranking, and freshness operators;
- trigger, invalidation, expiry, and exit sections;
- position-sizing and liquidity constraints when used in backtests.

Natural-language conversion follows:

1. Text input.
2. AI or deterministic parser produces candidate JSON.
3. JSON Schema validation.
4. Semantic validation against the allowed indicator/operator registry.
5. Human-readable preview.
6. Historical dry run and backtest.
7. Explicit activation by Prot.

The parser cannot emit SQL, Python, JavaScript, URLs, or arbitrary function names. It never receives Supabase service credentials.

## 10. Signal contract

Every signal stores:

- symbol and signal date;
- intended next eligible session;
- direction and action label;
- horizon;
- rule id and immutable rule version;
- pattern instances used;
- input/evidence snapshot;
- passed and failed conditions;
- observation zone, trigger, invalidation, and expiry;
- data freshness and warnings.

Initial action labels are:

- `WATCH`
- `PROBE_BUY`
- `REDUCE`
- `EXIT`

## 11. Backtest conventions

- Signals calculated after close T cannot enter before the next eligible session.
- Default entry is next-session open with configurable slippage.
- Costs include buy fee, sell fee, tax, and optional liquidity impact.
- Delisted and inactive symbols remain in historical tests where data permits.
- Fundamental and disclosure data use `available_from`, not reporting period.
- Adjusted prices and corporate actions must be versioned.
- Walk-forward test ranges are distinct from parameter-selection ranges.
- Rule-version snapshots make completed results immutable.

Core outputs: win rate, expectancy, profit factor, CAGR, maximum drawdown, Sharpe, turnover, exposure, holding period, and results by pattern, sector, year, and market regime.

## 12. Portfolio and journal

Portfolio records transactions rather than editable calculated positions. Positions derive from transactions.

Risk features:

- position and portfolio exposure;
- sector concentration;
- stop distance and money at risk;
- ATR-based or fixed-risk position sizing;
- correlation warnings;
- R-multiple results.

Journal links a signal snapshot to Prot's decision, actual transactions, planned entry/stop/target, outcome, adherence, and notes.

## 13. Initial database modules

### Reference and market data

- `symbols`
- `symbol_sector_history`
- `universe_imports`
- `universe_import_rows`
- `daily_prices`
- `corporate_actions`
- `market_indices`

### Fundamental and disclosures

- `fundamental_periods`
- `fundamental_metrics`
- `disclosures`
- `disclosure_versions`

### Analysis

- `pattern_definitions`
- `pattern_instances`
- `pattern_points`
- `support_resistance_zones`
- `rules`
- `rule_versions`
- `signals`
- `signal_evidence`
- `signal_outcomes`

### Backtest and personal data

- `backtest_runs`
- `backtest_trades`
- `portfolios`
- `transactions`
- `journal_entries`
- `push_subscriptions`
- `user_settings`
- `job_runs`
- `job_run_items`

The physical SQL schema is delivered in Phase 1 after this logical model is accepted.

## 14. Security baseline

- Disable open signup after Prot's account is created.
- Row Level Security applies to all personal tables.
- Browser code never contains service-role, upstream market-data, or AI provider secrets.
- GitHub Actions and Vercel store secrets in their encrypted environment settings.
- Logs redact authorization headers, tokens, cookies, and database URLs.
- Rule text and AI responses are treated as untrusted input.

## 15. Phase 0 acceptance criteria

- Repository and local checkout are connected to the correct GitHub owner.
- GitHub CLI is authenticated as `vnxprotstock`.
- Vercel CLI is authenticated to Prot's Vercel account.
- Initial universe contains exactly 205 unique symbols and TDC maps only to `BDS_KCN`.
- Universe expansion behavior is specified.
- Daily, weekly, and monthly completion rules are specified.
- Disclosure point-in-time policy is specified.
- Pattern lifecycle and algorithms are specified.
- Rule DSL security boundary is specified.
- Backtest timing and anti-look-ahead conventions are specified.
- No production credentials are committed.

