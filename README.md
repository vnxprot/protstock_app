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

Phase 2 — the EOD connector, technical indicators, explainable price-pattern engine, analysis schema, and per-symbol workspace are implemented. Controlled production ingestion is being activated before the full-universe schedule.

See:

- [Phase 0 specification](docs/phase-0-spec.md)
- [Phase 1 data foundation](docs/phase-1-data-foundation.md)
- [Phase 2 core analysis](docs/phase-2-core-analysis.md)
- [Pattern engine specification](docs/pattern-engine-spec.md)
- [Initial universe](data/universe.csv)

## Planned phases

1. Data foundation — implemented
2. Core analysis and pattern engine — implemented
3. Screener and rules
4. Backtesting
5. Portfolio and journal
