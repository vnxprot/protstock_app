# Pattern engine specification

## 1. Purpose

The pattern engine detects explainable technical structures from completed OHLCV bars. It outputs candidates and evidence; it does not place trades and does not use an LLM to decide whether a pattern exists.

Initial pattern families:

- accumulation base;
- double bottom;
- double top;
- ascending, descending, and symmetrical triangles;
- bull and bear flags;
- candlestick patterns as supporting evidence only.

## 2. Shared primitives

### Adjusted bars

Pattern calculations use a consistent adjusted-price series. Volume adjustments and corporate-action boundaries must not create false gaps or breakouts.

### Pivots

A pivot is confirmed only after the required bars to its right exist. Storing `confirmed_at` prevents future information from leaking into historical results.

Pivot sensitivity is normalized with ATR and a bounded left/right window. The engine retains the bar index, timestamp, price, pivot type, ATR, and confirmation timestamp.

### Trendlines and zones

- Support and resistance are zones, not single exact prices.
- Zone width is based on ATR and recent price dispersion.
- Trendlines use robust regression over eligible confirmed pivots.
- Every candidate stores its anchor points, fit quality, and touches.

### Volume features

- ratio to 20-session average;
- ratio to same timeframe average;
- trend within the structure;
- up-volume versus down-volume;
- dry-up before a trigger;
- expansion on confirmation.

## 3. Pattern lifecycle

Allowed states:

1. `FORMING` — minimum structure exists but is not near a valid trigger.
2. `READY` — mature structure and price is within the configured trigger distance.
3. `CONFIRMED` — a completed bar satisfies breakout/breakdown conditions.
4. `FAILED` — invalidation occurs before or after confirmation.
5. `EXPIRED` — maximum age is exceeded without confirmation.
6. `SUPERSEDED` — a better overlapping representation replaces the candidate.

State changes append history. They do not rewrite past states.

## 4. Accumulation base

Candidate evidence includes:

- duration;
- total depth;
- rolling-range contraction;
- ATR contraction;
- support and resistance touches;
- resistance slope;
- volume dry-up;
- relative-strength behavior;
- distance to breakout.

Initial configurable defaults:

- daily duration: 20–90 completed sessions;
- weekly duration: 5–30 completed weeks;
- maximum depth: configurable by volatility class, with ATR normalization preferred;
- minimum two meaningful resistance tests;
- breakout only on completed close above the resistance zone;
- optional confirmation volume threshold.

Failure examples:

- close below the structural support zone;
- depth expands beyond the configured limit;
- volatility expands without directional resolution;
- candidate exceeds maximum age.

## 5. Double bottom and double top

Double-bottom structure:

- two confirmed pivot lows;
- bounded bar separation;
- low-price similarity using percentage and ATR tolerance;
- a valid intervening neckline pivot;
- optional positive relative-strength divergence;
- no disqualifying corporate-action discontinuity;
- confirmation only on completed close through the neckline zone.

Stored points:

- first bottom/top;
- neckline;
- second bottom/top;
- confirmation bar;
- invalidation level;
- measured-move reference.

Double top mirrors the geometry and adds distribution-volume evidence. Neither pattern is confirmed merely because the second pivot forms.

## 6. Triangles

Supported types:

- ascending: approximately flat upper boundary and rising lower boundary;
- descending: falling upper boundary and approximately flat lower boundary;
- symmetrical: falling upper and rising lower boundaries.

Minimum geometry:

- at least two qualified touches on each boundary;
- converging boundaries;
- most closes remain inside the structure;
- minimum duration and adequate remaining room before the apex;
- declining range or ATR is supporting evidence.

Confirmation requires a completed close outside the relevant boundary plus configurable ATR/percentage buffer. A breakout too close to or beyond the apex is downgraded or expired.

## 7. Flags

A flag contains an impulse pole and a short corrective channel.

Pole evidence:

- directional return materially exceeds recent ATR-normalized moves;
- occurs within a bounded number of bars;
- volume expansion is supporting evidence.

Flag evidence:

- shorter duration than a base;
- retracement remains below a configurable share of the pole;
- corrective channel opposes or pauses the pole direction;
- range and volume generally contract;
- confirmation follows the pole direction on a completed bar.

Bull flags are enabled first. Bear flags are retained for warnings and exit rules.

## 8. Candlestick evidence

Initial supporting patterns:

- pin bar;
- bullish/bearish engulfing;
- inside bar;
- doji;
- morning/evening star.

A candlestick pattern cannot independently produce `PROBE_BUY`, `REDUCE`, or `EXIT`. It can only change evidence or satisfy an explicitly combined rule that also contains structural context.

## 9. Multi-timeframe composition

Default composition:

- monthly structural trend;
- weekly setup/pattern;
- daily trigger.

Patterns are independently detected on resampled completed bars. A daily pattern is not automatically promoted to weekly. A signal stores the exact instances from every timeframe used in its decision.

## 10. Quality score

The quality score ranks candidates; it does not represent probability of profit.

Initial components:

- geometry and structural fit: 30%;
- volume behavior: 20%;
- multi-timeframe trend context: 20%;
- relative strength: 15%;
- market and sector context: 10%;
- data quality: 5%.

Thresholds remain configuration until walk-forward testing validates them. The UI must show component contributions rather than only the total.

## 11. Overlap and deduplication

- Candidates sharing most bars and the same trigger zone are grouped.
- Keep the highest-quality representation as primary.
- Alternatives remain linked for audit but do not produce duplicate notifications.
- A confirmed candidate can coexist with a larger forming structure when their timeframes or structural spans materially differ.

## 12. Stored evidence

Each pattern instance stores:

- pattern type and algorithm version;
- symbol and timeframe;
- start/end/confirmation timestamps;
- lifecycle state;
- anchor points and zones;
- trigger, invalidation, and expiry;
- feature values and quality components;
- source bar revision/version;
- reasons and warnings as structured codes;
- state-change history.

This data must reproduce the chart overlay and the human-readable explanation without recalculating against newer bars.

## 13. Backtest integrity

- Use only pivots confirmed by the simulated historical date.
- Do not fit a pattern using bars after its historical evaluation point.
- Use only completed higher-timeframe bars.
- Enter no earlier than the session following an after-close confirmation.
- Retain failed and expired candidates to measure false-positive rates.
- Report results by algorithm version and pattern subtype.

## 14. Validation plan

Before enabling signals:

1. Build a labeled reference set across liquid and illiquid symbols.
2. Review overlays for every supported pattern type.
3. Test corporate actions, missing bars, trading halts, and limit-price gaps.
4. Measure precision, recall, duplicate rate, and stability across small parameter changes.
5. Perform walk-forward strategy tests after transaction costs.
6. Require deterministic reproduction from the same input and algorithm version.

