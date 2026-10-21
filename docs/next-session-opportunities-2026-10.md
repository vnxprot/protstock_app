# Cơ hội phiên tới — NEXT_SESSION_V1

Research shortlist, independent of Champion orders. No backtest or profitability claim accompanies this release.

## Publication

After a same-revision EOD publication and PUBLISHED direct-minute Radar, `python -m protstock.opportunities` reads stored inputs, ranks one row per symbol and publishes an immutable snapshot. An atomic source-timestamp guard rejects a concurrent EOD/Radar change. The current-day pointer changes only after the full snapshot is stored. Pinned publication links continue to resolve after recalculation. Missing EOD/Radar/summary is distinct from a published empty result.

Initial recovery hypothesis: a fresh EMA20 reclaim in the last three intervals, RSI 45–65, improving MACD histogram, close in the top quarter of the candle, estimated average turnover at least VND 3bn. Minute confirmation requires complete symbol coverage, at least ten baseline sessions, UP events with price movement at least 0.5%, value at least VND 1bn, and combined eligible-event share at least 15% or value at least VND 5bn; close location at least 0.6. Impossible aggregate event volume is rejected. These are initial versioned hypotheses, not independently measured edges.

Recovery plus qualifying minute evidence or a published setup plus minute evidence earns PRIORITY. Recovery, minute evidence, existing setups or new momentum can earn OBSERVE. Extension (5% daily rise, existing extended status or >2 ATR above EMA20), system EXIT/REDUCE, broken reference support and expiry have separate labels. Monthly DOWN remains visible, not a discovery veto. Stops/triggers are copied only from system setups; rolling support/resistance are explicitly references. A campaign continues for up to five sessions without fresh evidence.

## Interface

Screener: Cơ hội phiên tới (default), Tín hiệu hệ thống (actions and WATCH), Nghiên cứu (minute events, momentum, funnel, MACD). Overview shows up to five candidates. Analysis shows the pinned evidence and date-bounded chart. Watchlist badges link to the same publication. Admin Settings → Thông báo stores Telegram preferences and delivery history.

## Telegram

Uses the existing Prot bot/destination. A separate shortlist digest is sent only after Radar publication; system order alerts retain their own category. At most five eligible new/upgraded/current-burst candidates, deduplicated per owner/trading date. Extended/risk/invalidated rows are excluded. Explicit repairs and date-range runs never notify. Single-day notification runs are restricted to the same Vietnam calendar date, weekdays, 15:00–22:59. No empty digest. A unique pre-send claim prevents parallel sends; ambiguous network delivery is recorded UNKNOWN and is not automatically retried. FAILED/UNKNOWN can be inspected under notification history. The release does not send intraday or repeated same-day follow-up messages.

The same database snapshot supplies both web and Telegram. Link queries include symbol, trading date and publication UUID. No Telegram secret is exposed to the browser. Member access is read-only; only the Prot administrator can edit notification settings; publishing and delivery writes are service-only.

## Deployment

Deploy migration `20261021020000_next_session_opportunities.sql`, then rebuild stored dates through `opportunities.yml` (`start_date` and `end_date`, notifications disabled). `database.yml` can dispatch this rebuild after successful migration. Future Radar workflows publish the summary and optional daily digest automatically. No backtest is dispatched by this release.
