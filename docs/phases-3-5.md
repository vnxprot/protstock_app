# Phases 3–5 implementation

## Phase 3 — rules and screener

- Vietnamese text compiles to a restricted JSON DSL; no generated code is executed.
- Supported primitives: N-session breakout, volume/average ratio, MA20 > MA50 > MA200, RSI range, and percentage stop-loss.
- Every edit creates a new immutable `rule_versions` row.
- EOD evaluates active versions on their selected D/W/M timeframe and persists explainable signals.

## Phase 4 — backtest

- Signals are evaluated at the close and filled at the next bar, preventing same-bar look-ahead.
- Fees, sell tax, slippage, stop-loss, trailing stop, and time-stop are explicit assumptions.
- Metrics include win rate, expectancy, profit factor, CAGR, maximum drawdown, Sharpe, turnover, total return, and buy-and-hold comparison.
- Walk-forward windows keep training observations strictly before test observations.
- Runs reference immutable rule versions so old results remain reproducible.

## Phase 5 — portfolio and journal

- One-owner portfolios track quantity, average cost, stop, and thesis.
- Position sizing caps loss by capital risk percentage and can tighten stop distance using ATR.
- Journal entries link symbol, optional signal, decision, setup, market state, rationale, outcome, and lesson.
- The workspace surfaces recurring losing setup and sector fields without adding multi-user analytics.

## Production activation

Apply migrations `20260909030000` through `20260909060000`, reload the PostgREST schema, run a one-symbol EOD smoke test, then backfill the 205-symbol universe in bounded batches.
