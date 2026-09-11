# Prot Stock App

Personal PWA for end-of-day analysis of a curated Vietnamese stock universe.

## Product boundaries

- Single-user, non-commercial application for Prot.
- Current universe: 202 unique symbols.
- End-of-day processing only; no real-time market data.
- Daily, weekly, and monthly analysis.
- Deterministic, versioned rules and explainable price-pattern detection.
- Supabase for Postgres/Auth, GitHub Actions for batch jobs, and Vercel for deployment.

## Current phase

Phases 2–5 are implemented in code: multi-timeframe EOD analysis, versioned natural-language rules, screener signals, no-look-ahead backtest engine, portfolio risk sizing, and decision journal. Production database migrations and the initial full-universe backfill are the remaining activation steps.

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
