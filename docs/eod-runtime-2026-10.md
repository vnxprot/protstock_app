# Direct public market data, 20 October 2026

- VCI is the primary direct source for all 277 active manifest symbols, benchmark,
  daily history, minute bars, metadata and corporate-action candidates. KBS is the
  direct backup for day/minute/directory availability. No vnstock runtime,
  package index, API key, device registration, paid data plan or self-hosted PC
  is used. Vendor access, throttling and future policy changes still apply.
- GitHub keeps two independent lot processes on one runner. Public HTTP calls
  are paced to one per second per process, with bounded 429/network retries.
- Primary dispatch remains 15:30 Vietnam with GitHub's backup schedule. Exactly
  one Supabase Watchdog remains at 15:35; no later Watchdog schedules are added.
- The historical filename vnstock-health.yml remains only so the existing
  Supabase cron URL works. Its job now probes the public VCI/KBS contracts and
  reports changed health states. There is no SDK-release approval step.
- AUTO tries VCI each session, regardless of yesterday's vendor. A vendor change,
  old SDK contract, or corrected overlap triggers full 2021+ window retrieval.
  The chosen vendor is pinned during that retrieval; cross-vendor partial
  windows are never spliced together. Invalid latest data can trigger an
  explicitly labelled KBS fallback; an empty no-trade session is never fabricated.
- Direct VCI has a new data revision. Legacy bars omitted by a refreshed source
  remain available for audit but are excluded from current calculations.
  Index calculations likewise select only the refreshed direct VCI history.
- VCI raw stock prices are VND/share, normalized to thousand VND for daily prices.
  Minute storage stays in VND, and benchmark prices stay in index points.
  Day windows are at most 365 calendar days; minute windows at most two days,
  with backwards pagination and duplicate/array/symbol integrity checks.
- Minute baselines keep one minute source. KBS fallback against VCI daily data
  requires both daily OHLC agreement and the existing volume-coverage check.
- Direct metadata sync preserves the locked universe and existing sector rules;
  it updates exchange labels without deactivating absent/deregistered symbols.
  Corporate-event candidates remain SOURCE_REPORTED, not independently verified.
- refresh_research=true refreshes all active symbols from 2021 into verified
  private Storage archives after EOD; old immutable archives remain recoverable.
  Research readers select one source/version/basis, and no backtest is started.
- Repairs can force all symbols once. Subsequent bounded retries process their
  explicit failed-symbol list even when a snapshot from an earlier run exists.
  Operational Telegram reports remain enabled when signal alerts are suppressed.
- A one-off refresh finishes with bounded VACUUM FULL on the four rewritten
  market-data tables to reclaim database space without deleting prices. A busy
  table fails the maintenance step after a five-second lock timeout rather than
  blocking application writes indefinitely.

## Completion policy — 20 October 2026

- Missing current-session candles are recorded as skipped, never fabricated or
  automatically retried. Final publication succeeds with COMPLETE_WITH_MISSING;
  Pipeline retains the missing ticker list and actual coverage. Technical failures
  still fail the workflow. Even zero returned candles can finish without publishing
  invented signals or Market Health.
- Fast Lane remains scheduled at 15:30 Vietnam time, with two parallel lots.
  The single 15:35 Watchdog checks publication completion, so missing candles do
  not cause a second run.
- Intraday has one automatic entry point: explicit dispatch from successful Fast
  Lane finalization with its exact trading date. Independent cron and workflow_run
  triggers are removed. Two lots include only symbols with same-day EOD prices and
  snapshots. Terminal sessions are not retried automatically under the same source
  policy; a manual refresh remains available. Minute publication still requires
  95% baseline coverage among eligible symbols.
- `publish_only=true` finalizes stored EOD without fetching prices. Database
  deployment can chain this operation using `publish_eod_date`; this also starts
  the Intraday guard after the schema is ready.
- Portfolio accepts valid VCI/KBS closing prices without an entitlement valuation
  gate. Cash dividends are gross receivables from the ex-date, separate from cash.
  Only an explicit owner-recorded net receipt credits cash, once per event. A
  scheduled payment date never creates cash. Share rights remain informational
  until reflected in the transaction ledger. Vendor-adjusted historical prices
  are used as supplied; this ledger is not a broker cash reconciliation.
