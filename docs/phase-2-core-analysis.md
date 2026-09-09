# Phase 2 — Core analysis and pattern engine

## Delivered

- Community `vnstock` connector using KBS by default and VCI as a fallback option.
- Canonical EOD ingestion into `daily_prices`, with per-symbol job isolation.
- SMA 20/50/200, EMA 20/50, RSI 14, MACD, Bollinger Bands, ATR 14, volume average and ratio.
- Deterministic detectors for accumulation bases, double bottoms/tops, triangles, and flags.
- Immutable algorithm version and structured reasons/evidence for every stored candidate.
- Phase 2 database tables with authenticated read access and service-role-only writes.
- Per-symbol page with candlesticks, volume, MA overlays, indicators, patterns, disclosures, and explicit empty states.

## Data-source decision

The connector uses the community `vnstock` package, whose license targets personal, non-commercial use. This matches Prot Stock's locked product boundary. KBS is the default because the current upstream documentation recommends it for community usage. The provider is isolated behind an adapter so it can be replaced without changing the database or analysis engine.

## Guardrails

- The app is EOD only.
- A failed symbol does not fail or duplicate the whole run.
- Browser code receives only the Supabase publishable key.
- The service-role key remains in GitHub Actions secrets.
- Pattern detection is deterministic; AI is not allowed to decide whether a pattern exists.
- Empty or insufficient histories produce no fabricated values.

## Activation sequence

1. Apply `20260909030000_phase2_analysis.sql`.
2. Push the Phase 2 commit.
3. Manually run EOD with `symbol_limit=1`.
4. Verify a price row, technical snapshot, and job status.
5. Backfill the universe in controlled batches.
6. Enable the weekday schedule only after the controlled backfill is healthy.

