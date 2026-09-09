# Phase 1 — Data foundation

## Outcome

Phase 1 establishes an auditable, point-in-time-safe storage layer before any indicator, pattern, rule, or backtest is implemented.

## Delivered schema

- `symbols` with activation state and expandable metadata.
- `symbol_sector_history` maintained automatically when a sector changes.
- `universe_imports` and `universe_import_rows` for preview/apply audit trails.
- `daily_prices` as the canonical OHLCV source.
- `derived_bars` for completed or forming weekly/monthly bars.
- `market_indices` and `market_index_prices` for VN-Index, HNX-Index, and UPCoM-Index.
- `corporate_actions` with source and collection timestamps.
- `disclosures` and immutable `disclosure_versions` with `available_from`.
- `job_runs` and `job_run_items` for EOD observability and safe retries.
- `user_settings` scoped to the authenticated Prot account.

## Access model

- Browser clients use the publishable Supabase key and must authenticate.
- Authenticated clients can read reference, market, disclosure, and job-health data.
- Only the service role used by the batch pipeline can write shared market data.
- A signed-in user can only read and update their own `user_settings` row.
- No service-role credential belongs in Vite source or a `VITE_*` environment variable.

## Universe bootstrap

`data/universe.csv` remains the canonical initial import: 205 unique symbols, with TDC mapped only to `BDS_KCN`.

The initial dashboard import targets `symbols` and maps:

| CSV column | Database column |
| --- | --- |
| `symbol` | `symbol` |
| `sector` | `sector` |
| `active` | `active` |

Generated IDs and timestamps use database defaults. The sector-history trigger records the first sector assignment automatically.

## EOD contract for this phase

1. Start one `job_runs` row for the target trading date.
2. Load the active universe.
3. Normalize and validate every OHLCV row before upload.
4. Upsert by `(symbol_id, trading_date)`.
5. Derive weekly and monthly bars and set `is_complete` explicitly.
6. Store per-symbol status in `job_run_items`.
7. Close the job with counts, warnings, and a redacted error summary.

The first live upstream connector is intentionally selected only after its current terms, stability, and field semantics are verified. This prevents the database contract from depending on an undocumented vendor response.

## Acceptance criteria

- Migration applies cleanly to the `Prot Stock` Supabase project.
- The seed universe contains exactly 205 active rows and no duplicate symbol.
- TDC has sector `BDS_KCN`.
- Inserts automatically create sector-history rows.
- Invalid OHLCV rows are rejected by database constraints.
- Weekly/monthly rows cannot be confused with canonical daily prices.
- All exposed tables have RLS enabled.
- Production deployment remains buildable with no committed credentials.
