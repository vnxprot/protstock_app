# Prot Stock database capacity

## Verified baseline, 10 October 2026

Supabase reported 596.01 MB for the database. The largest relations were
`research_price_bars` (143.29 MB), `signal_funnel_assessments` (120.91 MB),
`macd_divergence_assessments` (77.70 MB), `daily_prices` (69.07 MB), and
`support_resistance_zones` (37.92 MB). The V2 funnel and V4 MACD versions used
by the app occupied only about 0.3 MB and 4.3 MB of row data respectively;
most assessment space was in earlier replay versions.

## Data that remains online

- Funnel V2 and MACD Zone V4 assessments stay in Postgres for daily screening
  and the MACD history shown in the app.
- The last 400 calendar days of KBS research prices stay in Postgres. Signal
  outcome calculation and recent backtests can use this series. Older backtests
  use the stored price series and label that price basis explicitly.
- `daily_prices`, published signals, user portfolios, and outcome records are
  not changed by the capacity job.

## Archive and cleanup

Run the **Archive and reclaim database capacity** workflow first in `archive`
mode. It creates a private `database-archives` Storage bucket if necessary,
exports research prices and sync status plus superseded funnel/MACD versions
as compressed CSV, and downloads each uploaded object to verify its SHA-256.
Each run has an immutable `capacity/<run-id>-<attempt>/` prefix and a
`manifest.json` with table predicates, row counts, checksums, and the cutoff.

Run the same workflow in `archive-and-clean` mode to take and verify a fresh
archive, remove research prices older than 400 days and superseded assessment
versions, then run `VACUUM FULL` on the three affected tables. This maintenance
briefly locks those tables. The job checks archived row counts again before
deleting anything. If Storage upload, download verification, or row-count check
fails, cleanup does not start.

Every Sunday after the KBS sync, the workflow runs in `rollover` mode. It
archives the bars leaving the 400-day window before deleting them. Routine
rollover relies on autovacuum to reuse the space; it does not lock tables with
`VACUUM FULL` each week. The KBS sync only requests the same 400-day window and
skips bars whose price, volume, quality, and source version have not changed.

## Restore

Download the private archive objects using a service-role credential. Verify
each downloaded file against `manifest.json` before decompressing it. The CSV
files retain the table column headers and can be imported with PostgreSQL
`COPY` into the corresponding tables after confirming the current schema and
primary-key conflicts. Restore into an isolated database first; replaying old
assessment versions directly into production could exceed the Free quota again.
For a historical price audit, load only the required symbols and dates into a
temporary environment or a deliberately sized paid database.

The manual historical replay workflows default to dry-run. Persisting old
assessment versions requires an explicit `ALLOW_LEGACY_REPLAY_PERSIST=true`
maintenance override. Broad research-price writes older than 400 days require
`ALLOW_FULL_RESEARCH_PRICE_SYNC=true`. These overrides are intentionally absent
from scheduled workflows.
