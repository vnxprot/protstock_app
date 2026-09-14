# Pivot-zone quality and Fibonacci confluence

Pivot clusters remain the primary support/resistance method: a 160-bar window,
two-sided confirmed pivots, 1.8% clustering tolerance, at least two touches, and
the strongest six zones. Fibonacci cannot generate a zone or an independent vote.

## Quality score (0–100)

- Touches: `min(60, 20 + 10 × touches)`.
- Volume: average pivot volume / preceding 20-bar volume average, capped at 15 points.
- Candle reaction: distance of close from support low / resistance high relative
  to the candle range, capped at 15 points. This is not a success probability.
- Recency: up to 10 points, linearly decaying with bars since last confirmed touch.
- Fib overlap: at most 4 additional points, total score still capped at 100.

Volume is **volume at touch candles**, not a tick-level volume profile or an
estimate of traded volume at every price. Missing volume adds no volume points.

## Fibonacci

Only completed weekly/monthly candles are used. Confirmed pivots require two
neighbors on each side. A clear upward swing requires at least 4 weekly / 3 monthly
bars, a 12% weekly / 20% monthly advance, and amplitude at least three times its
average candle range. These are conservative initial defaults, not calibrated
claims. Broken or substantially exceeded swings are rejected.

38.2%, 50%, and 61.8% levels must overlap a pivot SUPPORT zone, weekly EMA20/SMA50,
or an already-valid pullback setup within 1.5%. Confirmed bullish structures may
receive at most +4 quality points and `FIB_CONFLUENCE`. READY patterns remain READY.
All existing entry, volume, liquidity, MTF, market, portfolio and EXIT gates remain.
Frozen Core v1 decisions are unchanged; no additional confluence engine is counted.

The card shows touch volume, candle reaction, last-touch date and expandable Fib
evidence. No new database schema, upstream data subscription, or paid AI is needed.

## Refreshing existing cards

`python -m protstock.zone_refresh --date YYYY-MM-DD` refreshes D/W/M zone snapshots
from stored daily OHLCV only. It does not fetch prices, replay signals, or send
Telegram. It upserts the new six zones before deactivating obsolete same-day bounds;
older snapshots remain intact. The manual GitHub workflow has the same EOD lock.
Normal EOD and signal-only replay use the same Fibonacci context going forward.
