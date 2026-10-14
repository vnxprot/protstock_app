# Prot Stock v0.0.0 · restart checklist

Prot Stock remains a personal, non-commercial app. The current universe is the
277 active symbols in `data/universe.csv`, including TLG. The CSV is the sole
membership manifest; future changes are allowed by editing and reseeding it.

## Canonical market-data contract

1. Vnstock generation 5 requests VCI OHLCV for equities and VN-Index.
   Operational VCI failures, invalid OHLC bars, omitted last sessions or empty
   histories use KBS. A calculation window has one vendor and one data
   revision; switching vendor refreshes the whole window.
2. Each stored bar records the vendor, source version, reported OHLCV, price
   unit, quality and a revision hash. EOD calculations trust the selected
   vendor's price and volume directly. The pipeline does not invent a price
   or volume adjustment factor, and corporate-action verification does not
   block indicators or signals. Corporate actions remain separate from this
   calculation path for personal portfolio rights and historical audit.
3. Historical ingestion and calculations cover available sessions from
   1 January 2021 onward, or from the first actual listing/session. The read
   limit follows calendar time instead of stopping at 1,300 sessions.
   MA, MACD, RSI, ATR, divergence, stops, volume ratios, Flow, patterns and
   zones all use the same selected vendor series.
   Missing vendor sessions and insufficient listing history are reported as
   gaps, never synthesized. Historical cash trade backtests spanning later
   rights events still require original tradable prices and entitlements.
4. The price chart exposes source and basis. The ex-rights calculator requires
   a manually verified original price for past events. Portfolio NAV and
   reports are withheld when a position's rights or cash entitlement has not
   been entered in the portfolio transaction ledger.

Historical IDs and frozen user evidence retain their old revision names.
Current publication IDs, research assessment IDs, app/PWA labels and active
Core Pack rule versions begin at v0.0.0.

## Release order

- [x] Check manifest uniqueness and TLG membership.
- [x] Implement VCI/KBS whole-window source control and event provenance.
- [x] Add provenance, comparable-volume guards and fresh v0.0.0 IDs.
- [x] Pass Python, web build, frontend and SQL migration tests locally.
- [x] Commit and push the v0.0.0 code.
- [x] Apply all v0.0.0 Supabase migrations, including the breadth quality denominator.
- [x] Apply the TLG and TRC verification migrations.
- [x] Assert the live universe matches the 277-symbol manifest.
- [x] Sync VCI event candidates: 277 symbols, 3,652 new events, zero failed symbols.
- [x] Use vendor OHLCV without independent event-based volume boundaries.
- [x] Backfill the 277-symbol universe in small batches, then retry only vendor-data errors.
- [x] Keep historic TLG/TRC event records outside the EOD calculation path.
- [x] Publish and inspect a partial 12 October EOD with the buy gate closed.
- [ ] Publish a current EOD and report coverage against the 277-symbol manifest.
- [ ] Backfill and audit every available 2021-to-current session for all 277 symbols.
- [x] Deploy frontend on Vercel and confirm the live title is `Prot Stock v0.0.0`.
- [x] Inspect the live data-quality state after the canonical backfill.

The Market Health view reports actual missing prices and short histories.
Publication coverage is determined by available price sessions and eligible
history, with partial coverage shown explicitly.

The database was 275 MB on 12 October 2026 when read through the linked
Supabase project. Batch backfills and monitor headroom against the Free plan's
500 MB database quota. GitHub Actions and Vercel usage must also stay within
their personal/free limits. No paid service is required by this design.

The initial full ledger import on 13 October 2026 left 921 source-reported
share events and 214 rights issues without independent verification. These
events remain visible for audit; their dates bound volume comparisons.

## Live 12 October 2026 EOD audit

- Universe: 277 active symbols, including TLG. The canonical daily price table
  has current-session bars for 275 symbols: 254 from VCI and 21 from KBS.
  DVM and GVT have no current-session bar from either source.
- Current v0.0.0 daily snapshots: 75/277. Market Health observed 73/275
  price-present eligible symbols (26.55%); 202 were quality-blocked and two
  had no current-session data. Publication and coverage are `PARTIAL` and
  `INCOMPLETE`. The market health headline is withheld on incomplete coverage.
- Ten current-revision consolidated signals were stored, all `WATCH`; zero
  `BUY`. No incomplete market sample authorizes new buys.
- The database measured 344 MB after the full backfill and targeted retry,
  below the 500 MB Supabase Free database
  quota. Recheck actual usage as the data grows; no paid plan is configured.

The figures above describe the 12 October state before the revised policy was
deployed. They are retained as an audit baseline, not current coverage.
