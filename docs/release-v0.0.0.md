# Prot Stock v0.0.0 · restart checklist

Prot Stock remains a personal, non-commercial app. The current universe is the
277 active symbols in `data/universe.csv`, including TLG. The CSV is the sole
membership manifest; future changes are allowed by editing and reseeding it.

## Canonical market-data contract

1. Vnstock generation 5 requests VCI OHLCV for equities. Operational VCI
   failures, invalid OHLC bars, omitted last sessions or empty histories use KBS.
   A calculation window has one vendor
   and one data revision; switching vendor refreshes the whole window.
2. Each stored bar records vendor/source version, vendor volume, comparable
   share volume, volume factor, price/volume basis, quality and a revision hash.
   VCI describes its OHLC as adjusted but does not publish the exact factors
   used for every event. No `adjustment_factor` is invented for price.
3. VCI company events are candidates. Share-volume rebasing requires a
   separately verified entitlement **and** a verified finding that the vendor
   volume before the event was unadjusted. The VSDC TRC 1:3 bonus event of
   September 2026 and TLG's two 10:1 stock dividends of November 2024 and
   December 2025 have verified factors. Duplicate VCI/VSDC descriptions apply
   once. Employee and private placements carry no existing-holder factor.
   The daily job checks the market-wide VCI dividend calendar, while a weekly
   full refresh catches older or revised company disclosures without spending
   a full-universe job on every trading day.
4. The current calculation window uses up to 1,300 trading sessions, covering
   more than 50 complete monthly bars. Older records remain stored for audit.
   Unverified share-event windows, including conflicting vendor ratios, have
   `WARNING` quality. Core Engine,
   Core Pack, Flow, Market Health, Funnel, Radar, MACD, outcomes and backtests
   use a canonical window or withhold the result. Historical cash trade
   backtests spanning later rights events remain blocked until original
   tradable prices and entitlements can be replayed.
5. The price chart exposes source and basis. The ex-rights calculator requires
   a manually verified original price for past events. Portfolio NAV and
   reports are withheld when a position's rights or cash entitlement has not
   been entered in the portfolio transaction ledger.

Historical IDs and frozen user evidence retain their old revision names.
Current publication IDs, research assessment IDs, app/PWA labels and active
Core Pack rule versions begin at v0.0.0.

## Release order

- [x] Check manifest uniqueness and TLG membership.
- [x] Implement VCI/KBS whole-window source control and event provenance.
- [x] Add fail-closed quality gates and fresh v0.0.0 IDs.
- [x] Pass Python, web build, frontend and SQL migration tests locally.
- [x] Commit and push the v0.0.0 code.
- [x] Apply all v0.0.0 Supabase migrations, including the breadth quality denominator.
- [x] Apply the TLG and TRC verification migrations.
- [x] Assert the live universe matches the 277-symbol manifest.
- [x] Sync VCI event candidates: 277 symbols, 3,652 new events, zero failed symbols.
- [ ] Review unresolved event classes before claiming complete technical coverage.
- [x] Backfill the 277-symbol universe in small batches, then retry only vendor-data errors.
- [x] Audit TLG/TRC source-volume factors and quarantine unresolved event windows.
- [x] Publish and inspect a partial 12 October EOD with the buy gate closed.
- [ ] Publish a complete EOD after independently verifying the remaining entitlements.
- [x] Deploy frontend on Vercel and confirm the live title is `Prot Stock v0.0.0`.
- [x] Inspect the live data-quality state after the canonical backfill.

The Market Health view now counts symbols awaiting event verification separately
from missing prices and short histories. A partial publication is allowed for
inspection, but must not be described as complete while the event ledger has
unverified shareholder entitlements.

The database was 275 MB on 12 October 2026 when read through the linked
Supabase project. Batch backfills and monitor headroom against the Free plan's
500 MB database quota. GitHub Actions and Vercel usage must also stay within
their personal/free limits. No paid service is required by this design.

The initial full ledger import on 13 October 2026 left 921 source-reported
share events and 214 rights issues without independent verification. These
events remain visible for audit. Windows crossing them are withheld rather
than labelled as valid comparable-volume history.

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

The remaining quality work is independent verification of holder entitlements
and vendor volume bases for the unresolved event windows. The system keeps
those symbols visible with explicit quarantine instead of inventing factors.
