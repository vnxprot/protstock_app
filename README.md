# Prot Stock App · v4.1.2

Personal PWA for end-of-day analysis of a curated Vietnamese stock universe.

## Product boundaries

- Single-user, non-commercial application for Prot.
- The active trading universe is defined in `data/universe.csv`.
- End-of-day processing only; no real-time market data.
- Daily, weekly, and monthly analysis.
- Deterministic, versioned rules and explainable price-pattern detection.
- Supabase for Postgres/Auth, GitHub Actions for batch jobs, and Vercel for deployment.

## Version 4

Windows provides the full research workspace. iPhone navigation prioritizes Overview, Watchlist and Journal, with remaining tools in the account menu according to account permissions.

Investment theses have immutable versions and conflict detection. Journal decisions retain their original system evidence and thesis version. Watchlist and new journal entries retain pending changes on the device for retry after connection failures.

Backtests use the live engine dispatcher and policy, VND cash accounting, indicator warm-up and next-session open execution. Portfolio NAV replays transactions and capital movements chronologically. Database RPCs provide atomic, idempotent capital/trade writes and complete report histories beyond REST row limits.

Daily processing uses balanced shards, bounded retries, heartbeat checks and explicit COMPLETE/PARTIAL publication status. Analysis and screening queries are bounded and share a publication date/revision.

See [v4 release notes and validation](docs/release-v4.0.0.md).

## Version 4.1

The interface uses Plus Jakarta Sans and Inter, restores layered glass surfaces, improves light-theme contrast and control sizing, and adds a concise takeaway to stock analysis. The full UI acceptance criteria are in [the v4.1 specification](docs/ui-ux-v4-1-polish-specification.md).

Version 4.1.1 groups signal research into four tabs, unifies table filters and pagination, restores the v3 Watchlist and mobile bars, and refreshes the decision journal timeline.

See:

- [Phase 0 specification](docs/phase-0-spec.md)
- [Phase 1 data foundation](docs/phase-1-data-foundation.md)
- [Phase 2 core analysis](docs/phase-2-core-analysis.md)
- [Phase 3–5 implementation](docs/phases-3-5.md)
- [Pattern engine specification](docs/pattern-engine-spec.md)
- [Initial universe](data/universe.csv)

## Planned phases

1. Data foundation — implemented
2. Core analysis and pattern engine — implemented
3. Screener and rules — implemented in code
4. Backtesting — engine and result workspace implemented
5. Portfolio and journal — implemented in code

## Scope limits

- No backup infrastructure is included, as requested.
- Corporate-action collection is incomplete; unadjusted historical prices can affect backtests.
- Historical sector statistics use the stored/current sector classification.
- Market Health and pattern scores are heuristics, not win probabilities. Prot Flow is a price/volume pressure measure, not identified or net investor flows.
- No new paid service or native app is required. Provider and free hosting limits still apply.

## Data source

- EOD OHLCV uses KBS's public endpoint. The CLI rejects VCI until a separate adapter exists. New bars record their source, fetch time, price unit, and adapter version; older bars without verified provenance remain labeled as such.
- The provisional vnstock/VCI fundamentals collector is disabled, and its old rows are hidden from stock analysis. Historical records remain in the database for audit.
- Monthly context, weekly setup, and daily trigger research runs in a shadow funnel. It does not change live signals while historical outcomes and corporate-action coverage are being validated.
