# CAN SLIM and price-cycle modules

Two independent navigation destinations: `#canslim` and `#cycle`. Both reuse
canonical vendor OHLCV and the latest successful EOD publication. Neither
changes Champion signals, sends alerts, runs a backtest, or fetches fundamentals.

CAN SLIM combines personal C/A/N/I checks with explicitly labelled technical
S/L/M proxies. Missing evidence stays unknown. C/A confirmations need a reporting
period; passing personal checks require an HTTP(S) source. Reviews are owner-scoped,
Admin-only writes, optimistic-versioned, bounded in length and stale after 90 days.
Unsubmitted/failed edits remain device-local drafts scoped by owner and symbol.
They are not automatically replayed across sessions or accounts.

The reference technical setup is a 50-session range of 5–30% depth. Near-pivot
means within 5% below the previous 50-session high; breakout means 0–5% above
with volume at least 1.5 times the prior 50-session average (excluding today).
RS Prot is a tied midrank percentile of 252-session returns, with at least 20
eligible stocks. It is not IBD's proprietary RS Rating or RSI. S is a demand
proxy only, not a full analysis of shares outstanding/free float. M requires
COMPLETE market coverage, RISK_ON and an UP index trend. The full-check preset
also requires NORMAL trading and median 20-session turnover >=1 billion VND.

Weekly cycle rules use only completed weeks and at least 34 weeks of history.
They combine 30-week MA, four-week slope, eight-week return/range and the prior
twelve-week move. Two matching closed-week classifications support a state;
otherwise a new candidate is TRANSITION. Accumulation/distribution remain
hypotheses, not proof of identified institutional buying/selling. Existing daily
Wyckoff events provide separate context. No forward-labelled stage history is
replayed: only the actual observation date of changes is persisted.

One current row per symbol, at most 60 changes per symbol and at most 730 days
of observed events. No duplicate OHLCV, daily full-history assessment tables,
financial PDFs, raw financial payloads, paid feeds, or new hosting service.
Publishing is atomic and service-only; it requires the complete active universe
on the latest EOD date/revision. Optional refreshes stop at 450,000,000 database
bytes or 25,000,000 module bytes, reserving room below the 30 MB module budget.
Reviews stop at a 470 MB database reserve. Actual database size and other tables
still need the existing database-capacity maintenance; this module cannot cap
unrelated workflows. Automatic VACUUM reuses pages; ordinary deletion does not
necessarily shrink the provider's physical usage measurement.

Dispatch **CAN SLIM and Cycle refresh** once to apply migrations and seed current
views asynchronously. Subsequent successful **EOD Fast Lane** / **EOD pipeline**
runs refresh them through workflow_run. No monitoring, replay, backtest or user
acceptance step is required by this rollout. Frontend tolerates an absent schema,
empty initial outputs and stale/partial prices while the worker runs.
