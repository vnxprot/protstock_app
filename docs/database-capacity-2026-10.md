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
- KBS research prices live in private Storage as immutable compressed per-symbol
  JSON objects with verified SHA-256 manifests. Research workers transparently
  read the archive; new syncs update Storage instead of refilling Postgres.
- Current Challenger WATCH assessments stay online for 180 days. Older WATCH
  rows are archived unless an outcome references them. Actionable assessments,
  published signals, user decisions and outcome records remain online.
- `daily_prices`, published signals, user portfolios, and outcome records are
  not changed by the capacity job.

## Archive and cleanup

The `audit` mode is read-only. It reports total PostgreSQL and Storage bytes,
relation data and index sizes, estimated dead rows, and compressed candidate
bytes. The `reclaim-history` mode applies the archive read policy, waits for the
frontend to deploy, and moves evidence older than 20 VNINDEX sessions to private
gzip objects, keyed by table, date and SHA-256. It covers Challenger, Momentum
Radar, the signal funnel, patterns and zones. Reasons, row identities and
outcome-linked Challenger strategy evidence stay online. Old analysis screens
load the archived evidence on demand. Daily and derived price bars are excluded
because the stock analysis view reads long price windows.

Each batch is uploaded and read back before changing the corresponding rows.
The transaction rechecks the exact rows under a write lock, then stores the
archive path and record key in the original `evidence` column. Existing object
names are reusable on retry. `VACUUM FULL` returns space to PostgreSQL after the
update. The workflow reports the observed size and queues Radar report backfill
only below 440 MB, leaving 10 MB of headroom per batch beneath its 450 MB limit.
It reports a capacity error if compaction is insufficient. The recurring
rollover also compacts eligible evidence when the database reaches 400 MB.

Managed archive writes check the entire project's Storage usage against 450 MB
before uploading, including the new object. Vendor snapshots skip unchanged
content. Superseded archive objects are retained for recovery.

Run the **Archive and reclaim database capacity** workflow first in `archive`
mode. It creates a private `database-archives` Storage bucket if necessary,
exports research prices and sync status plus superseded funnel/MACD, zone, and
Challenger strategy versions
as compressed CSV, and downloads each uploaded object to verify its SHA-256.
Each run has an immutable `capacity/<run-id>-<attempt>/` prefix and a
`manifest.json` with table predicates, row counts, checksums, and the cutoff.

Run the same workflow in `archive-and-clean` mode to take and verify a fresh
archive, install and verify the per-symbol research objects, remove the database
research cache and expired/superseded assessment and zone versions, then run
`VACUUM FULL` on the affected tables, including core price and derived tables to
reclaim update bloat without deleting their bars. This maintenance briefly locks
those tables and shares the EOD concurrency group. The job checks row counts and
content fingerprints under table locks before deleting anything.
If Storage upload, download verification, or fingerprint check
fails, cleanup does not start.

For the 2026-10-19 incident, dispatch `archive-and-clean` with
`repair_eod_date=2026-10-19`. After the database falls below 500 MB, the
workflow dispatches Fast Lane with alerts and personal backtests disabled.

Every Sunday the workflow runs in `rollover` mode. It offloads any research
cache rows and archives expired Challenger WATCH assessments. Routine rollover
uses normal VACUUM ANALYZE. Research sync skips unchanged bars and retains vendor
provenance in Storage. Logs report relation sizes and dead tuple estimates before
maintenance, the resulting database size, and warnings above the 400 MB operating
target. Repair is dispatched only below the conservative 500 MB limit.

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
maintenance override. Broad research-price syncs now write to Storage.
