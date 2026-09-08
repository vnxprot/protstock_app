# Prot Stock App

Personal PWA for end-of-day analysis of a curated Vietnamese stock universe.

## Product boundaries

- Single-user, non-commercial application for Prot.
- Initial universe: 205 unique symbols.
- End-of-day processing only; no real-time market data.
- Daily, weekly, and monthly analysis.
- Deterministic, versioned rules and explainable price-pattern detection.
- Supabase for Postgres/Auth, GitHub Actions for batch jobs, and Vercel for deployment.

## Current phase

Phase 0 — technical specification and architecture. No production application code has been started.

See:

- [Phase 0 specification](docs/phase-0-spec.md)
- [Pattern engine specification](docs/pattern-engine-spec.md)
- [Initial universe](data/universe.csv)

## Planned phases

1. Data foundation
2. Core analysis and pattern engine
3. Screener and rules
4. Backtesting
5. Portfolio and journal

