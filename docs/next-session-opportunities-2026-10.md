# Cơ hội phiên tới — NEXT_SESSION_V2

Research shortlist, independent of Champion orders. No backtest or profitability claim accompanies this release.

## Publication

After EOD publication, `python -m protstock.opportunities --phase EOD` publishes preliminary candidates without waiting for minute Radar. AUTO also builds a final snapshot when same-session direct-minute Radar is PUBLISHED. Both use the actual published EOD source revision. Source-timestamp guards reject concurrent source changes; final snapshots cannot be downgraded by a delayed EOD build. Pinned links remain immutable.

The context RPC returns compact metadata and symbol IDs. Input reads contain at most 25 unique symbols with only the fields consumed by the scorer. MACD variants are resolved deterministically to one result per symbol, preventing join multiplication. Read RPCs retry transient failures once; failed groups are isolated and reported. Partial coverage may produce an explicitly preliminary snapshot, never a final Telegram digest. Two consecutive failed groups or an eight-minute phase budget stops further reads. A token-owned lease and at most three attempts per input revision prevent overlapping or endless recovery. Changes to source data or the previous campaign snapshot invalidate the cached build.

Build status distinguishes NOT_STARTED, PROCESSING, FAILED and a lease older than twenty minutes (STALLED). Stored previews remain visible during errors. The interface shows coverage, attempt count, candidate status totals and exclusion counts; an empty list no longer implies that aggregation is still running. The default shows all candidates, including extension and risk labels. Candidate families identify recovery, continuation/setup and unusual volume without changing the evidence thresholds to fit a particular stock.

Initial recovery hypothesis: a fresh EMA20 reclaim in the last three intervals, RSI 45–65, improving MACD histogram, close in the top quarter of the candle, estimated average turnover at least VND 3bn. Minute confirmation requires complete symbol coverage, at least ten baseline sessions, UP events with price movement at least 0.5%, value at least VND 1bn, and combined eligible-event share at least 15% or value at least VND 5bn; close location at least 0.6. Impossible aggregate event volume is rejected. These are initial versioned hypotheses, not independently measured edges.

Recovery plus qualifying minute evidence or a published setup plus minute evidence earns PRIORITY. Recovery, minute evidence, existing setups or new momentum can earn OBSERVE. Extension (5% daily rise, existing extended status or >2 ATR above EMA20), system EXIT/REDUCE, broken reference support and expiry have separate labels. Monthly DOWN remains visible, not a discovery veto. Stops/triggers are copied only from system setups; rolling support/resistance are explicitly references. A campaign continues for up to five sessions without fresh evidence.

## Interface

Screener: Cơ hội phiên tới (default), Tín hiệu hệ thống (actions and WATCH), Nghiên cứu (minute events, momentum, funnel, MACD). Overview shows up to five candidates. Analysis shows the pinned evidence and date-bounded chart. Watchlist badges link to the same publication. Admin Settings → Thông báo stores Telegram preferences and delivery history.

## Telegram

Uses the existing Prot bot/destination. A separate shortlist digest is sent only after Radar publication; system order alerts retain their own category. At most five eligible new/upgraded/current-burst candidates, deduplicated per owner/trading date. Extended/risk/invalidated rows are excluded. Explicit repairs and date-range runs never notify. Single-day notification runs are restricted to the same Vietnam calendar date, weekdays, 15:00–22:59. No empty digest. A unique pre-send claim prevents parallel sends; ambiguous network delivery is recorded UNKNOWN and is not automatically retried. FAILED/UNKNOWN can be inspected under notification history. The release does not send intraday or repeated same-day follow-up messages.

The same database snapshot supplies both web and Telegram. Link queries include symbol, trading date and publication UUID. No Telegram secret is exposed to the browser. Member access is read-only; only the Prot administrator can edit notification settings; publishing and delivery writes are service-only.

## Deployment

Deploy the original migration `20261021020000_next_session_opportunities.sql` and recovery migration `20261022010000_opportunity_pipeline_recovery.sql`, then rebuild stored dates through `opportunities.yml` (`start_date` and `end_date`, notifications disabled). `database.yml` dispatches this rebuild only after successful migration. Range recovery processes the latest two sessions first, repairs older sessions in order despite individual failures, then refreshes the latest two campaigns. Failures stay visible in the workflow log and build records.

Fast EOD publishes preliminary discovery before its existing notification step. Radar completion publishes the final summary and optional daily digest. The existing watchdog can recover discovery independently of Radar completion and respects the same lease/attempt limit. Historical rebuilds never send Telegram; no backtest is dispatched by this release.
