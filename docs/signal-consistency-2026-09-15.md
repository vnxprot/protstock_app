# Signal consistency release — 15/09/2026

## Contracts

- Preserve OHLCV in vnstock's thousand-VND stock price unit. Only turnover and position sizing convert to VND. Portfolio cost, stop and capital are entered in VND. No historical price rewrites.
- Archive only the duplicate Pullback card with no versions. Preserve executing rule ID and historical raw signals.
- Only the latest version per active rule executes. RSI v1 remains available to historical references; v1.1 uses confirmed pivots, MACD and fixed price trigger.
- Every proposal passes shared safety policy before raw/consolidated storage. Stops on actual holdings preempt entry restrictions. No holding means REDUCE/EXIT becomes WATCH with a reason.
- Missing portfolio configuration leaves unsized candidates labelled SIZING_UNAVAILABLE_NO_PORTFOLIO; failed portfolio reads block entries. Current positions are not silently treated as historical holdings during replay.
- Core v1 detector is unchanged. Core v2 liquidity units are corrected without changing the intended 300m VND threshold. Other numeric live thresholds are not calibrated in this release.

## Higher timeframes

Core v2 owns D/W/M under one toggle. W: 13-week breakout with volume confirmation, or EMA20 pullback WATCH. M: EMA10/SMA20 trend transition WATCH, REDUCE on down-transition only for a holding. These are separate events, not daily logic renamed W/M.

Confirmation is conservative: the first observed session in a new period confirms the old period, including holiday-shortened weeks. Timestamp the signal on the confirmation date. Current developing W/M bars remain available for charts, but are excluded from official period events. No assumed future holiday calendar and no backdating.

## Outcome interpretation

Evaluate 5/10/20 future trading observations separately; never use bars beyond the requested as-of date. Reuse each symbol history and skip completed horizons. `forward_return_pct` is a fractional underlying-price return, not fill-based net P/L. Drawdown uses closing prices; stop breach uses lows. No inference of SELL win rate from positive forward returns. The view groups engine/timeframe/action/horizon and displays sample size.

The independent 18:30 Vietnam-time workflow does not block Fast Lane or alerts. It reads stored bars and does not fetch upstream data or alter thresholds. Manual dispatch is available. A recent signal may legitimately have zero outcomes until five subsequent sessions exist.

## UI

Shared engine ordering, styled keyboard-operable dropdowns, DD/MM/YYYY text + calendar date input, symbol/date-range/exact-date/timeframe/engine filters. Engine filter means contributors to the final consolidated decision, not every raw proposal. Settings includes seven engine guides and outcome sample sizes. Rebuild defaults to no Telegram.

## Verification

Breadth integrity: calculate over unique active symbols from stored daily snapshots, not the current retry batch. A partial batch cannot overwrite universe breadth. On reading D-1, repair legacy batch summaries from stored rows and require complete eligible coverage for entry permission; incomplete coverage is explicitly BREADTH_COVERAGE_INCOMPLETE, not a claim that the market is weak. This does not fetch missing historical prices or invent missing snapshots.

Run `python -m pytest tests/ -q`, `npm ci`, `npm run build`. Integration tests prove shared policy reaches raw and consolidated storage; verify migration RLS via owner JWT and execute the outcomes workflow after deployment. Browser QA covers light/dark, desktop/mobile, dropdown keyboard selection and date validation. No guarantee of improved performance is made until outcome samples mature.
