# Signal intelligence roadmap v2 — data policy & signal architecture

Status: DRAFT, supersedes `docs/signal-intelligence-roadmap.md` v1 in full. Builds on
`docs/pattern-engine-spec.md` and `docs/pattern-engine-spec-addendum.md`
(`core-rules-v2`). Written for a single-user, free-tier deployment (Supabase free
tier, GitHub Actions free minutes, community `vnstock` rate limits) after migrating
to a new Supabase project.

**Why this is a full rewrite, not a patch on v1:** a code review after the Supabase
migration found that `resolve_signal()` — the priority-ladder engine covered by
several rounds of review (EXIT short-circuit, bearish quality threshold, MA-stack
bonus, multi-timeframe gate) — **does not write to the `signals` table at all**.
`signals` is written by a completely separate, simpler mechanism: a loop over
user/seeded DSL rules (`rules`/`rule_versions`, evaluated by `evaluate_rule()` in
`rules.py`). Every gate v1 of this roadmap proposed adding to `resolve_signal` would
have been invisible to Telegram alerts / the UI, because the thing that actually
writes `signals` never calls `resolve_signal`. §0.5 below fixes this first; it is
the highest-priority item in this document, ahead of every Tier 1 item.

---

## 0. Data backfill policy

**Decision: 10-year rolling history for universe symbols, full history for the
VNINDEX benchmark only.** Unchanged from v1 — repeating here for completeness since
this is a full rewrite.

Rationale:
- Pre-2006 HOSE data is thin (a handful of listed names, low liquidity, different
  matching/band rules) and would dilute indicator/pattern quality more than help it.
- Most of the 205 symbols in `data/universe.csv` listed well after 2000 anyway.
- 2015–2025 already spans multiple regimes (2018 correction, 2020 COVID crash/
  recovery, 2022 bear market, 2023–2025 recovery) — enough for walk-forward
  calibration (§5) without the cost of 25 years × 205 symbols.
- VNINDEX is a single series — cheap to keep at full depth, useful for long-horizon
  relative-strength and regime context.

**Current state check (do this before anything else):** the codebase's
`price_history`/`index_price_history` reads cap at the most recent 260 trading days
(`supabase_rest.py`) — this is correct and unrelated to backfill depth (260 days is
enough for `sma200` plus buffer; it caps live analysis cost regardless of how much
history is stored). The backfill depth in `daily_prices` matters for two things
only: §1's D-1 breadth computation needs recent history to already be populated by
the time it runs, and §5's walk-forward calibration and §3's outcome evaluation need
years of history to be statistically meaningful. **After a fresh Supabase migration,
`daily_prices` starts empty and only grows by however many days each scheduled EOD
run's `lookback_days` fetches — an initial backfill has not happened automatically
and must be run once, manually, before any of the above can work.**

Implementation:
- Split `lookback_days` (symbols, unchanged default `10`, daily incremental
  catch-up) from a new `benchmark_lookback_days` parameter (VNINDEX only, default
  large enough to reach 28/07/2000).
- `cli.py`'s `eod` subcommand gets a matching `--benchmark-lookback-days` flag.
- The **initial backfill** for the 205 symbols is an operational act, not new
  product code: run `protstock eod --lookback-days 3650 --symbol-offset N
  --symbol-limit M` in controlled batches (respecting the existing rate-limit
  guardrail), then let the normal weekday schedule take over with the existing
  10-day incremental lookback. This must be run once against the new Supabase
  project before Tier 1 gates (which depend on accumulated history) are turned on.

---

## 0.5 — Consolidate the two signal-writing paths (do this before Tier 1)

**Problem, concretely:** `_write_analysis()` in `eod.py` writes `technical_snapshots`,
`pattern_instances`, and `support_resistance_zones` from `analyze_bars()`'s `result`
dict, but writes `signals` from a *different* loop entirely:

```python
for version in active_rules:
    dsl = version["dsl"]
    ...
    passed, reasons = evaluate_rule(dsl, result["indicators"], rows, result["patterns"], context)
    if passed:
        action = dsl.get("action", "WATCH")
        ...
        signal_rows.append({...})
counts["signals"] += client.upsert("signals", signal_rows, ...)
```

`evaluate_rule()` re-implements a subset of pattern/indicator condition-matching
independently of `resolve_signal()` — it has no EXIT short-circuit, no separate
bearish quality threshold, no MA-stack/relative-strength bonus logic, and cannot see
any gate added to `resolve_signal` (market regime, zone confluence, sector filter)
unless that gate is *also* hand-reimplemented as a DSL condition. This is the same
class of bug as the `relative_strength_market` divergence fixed earlier in this
project, except at the level of the entire signal engine rather than one field.

**Decision: `resolve_signal()`'s decision becomes the single source of truth written
to `signals`. User/seeded DSL rules stop being a duplicate signal engine and become
an optional overlay for conditions outside the core pattern ladder** (e.g. "notify
me when RSI14 < 25 regardless of pattern state" — a screen the core ladder was never
designed to express). The four seeded "Core v1" rules, which just reimplement pieces
of what `resolve_signal` already does, are retired (archived, not deleted) to avoid
duplicate/conflicting alerts for the same underlying decision.

### Schema changes (new migration, do not edit the existing `phase3_rules.sql`)

```sql
alter table public.signals alter column rule_version_id drop not null;
alter table public.signals add column if not exists source text not null default 'USER_RULE'
  check (source in ('CORE_ENGINE', 'USER_RULE'));
create unique index if not exists signals_core_engine_unique
  on public.signals (symbol_id, timeframe, as_of_date)
  where source = 'CORE_ENGINE';
```

The existing RLS policy on `signals` (in `phase3_rules.sql`) authorizes rows by
joining `rule_version_id -> rule_versions -> rules.user_id = auth.uid()`. This join
returns no rows when `rule_version_id` is null, silently hiding every `CORE_ENGINE`
row from the single owner user. Update the policy to also allow rows where `source =
'CORE_ENGINE'` (this is a single-user app; a `CORE_ENGINE` row has no per-rule
owner, so authorize it directly rather than trying to force it through the rule
ownership join).

Archive the seeded rules in the same or a following new migration:
```sql
update public.rules set status = 'ARCHIVED'
where name in ('Core v1 · Mua nền tích lũy', 'Core v1 · Mua hai đáy',
                'Core v1 · Theo dõi setup', 'Core v1 · Bán mẫu hình bearish');
```

### Pipeline changes (`eod.py`)

- `_write_analysis` builds one additional `signals` row directly from
  `result["signal_preview"]` / `result["reasons"]`, with `rule_version_id = None`,
  `source = "CORE_ENGINE"`, `score = 100`, `action = result["signal_preview"]`.
- **Storage discipline** (free-tier constraint, don't skip this): only insert a
  `CORE_ENGINE` row when `action != "WATCH"`, OR `action == "WATCH"` with at least
  one reason code that isn't just the default trend tag (i.e. a real
  `NEAR_TRIGGER_*` present) — skip the fully generic "nothing is happening" WATCH
  case. Writing a WATCH row for all ~205×3 symbol/timeframe combinations every day
  with no informational content is pure storage cost for zero value.
- The `active_rules` loop keeps writing `USER_RULE` rows exactly as today, for any
  rule that isn't one of the retired Core v1 set — this remains the mechanism for
  custom user-authored screens.

### `alerts.py` changes

- The query already selects `rule_versions(rules(name))` via PostgREST embedding —
  this returns `null` for `CORE_ENGINE` rows (no `rule_version_id`), and the current
  code (`signal.get("rule_versions", {}).get("rules", {})`) will crash on `None`,
  not fall through to `{}`, because PostgREST returns an explicit `"rule_versions":
  null` key, and `.get("rule_versions", {})` returns `None` (not `{}`) when the key
  exists but its value is null. Fix: `(signal.get("rule_versions") or
  {}).get("rules") or {}`.
- When the label resolves to nothing (a `CORE_ENGINE` row), use a fixed label, e.g.
  `"Prot Core Engine"`, instead of the current `"Rule"` fallback, so Telegram
  messages read clearly (`"PROBE_BUY VNM · Prot Core Engine"` vs `"PROBE_BUY VNM ·
  Rule"`).
- No change needed to the `action in.(PROBE_BUY,ADD,REDUCE,EXIT)` filter or the
  dedupe-by-`signal_id` logic — both already work identically regardless of `source`.

### Migration/backfill note for existing data

This is a schema + behavior change on a fresh Supabase project with (per §0) close
to no historical `signals` rows yet — there is no meaningful backfill of past
`CORE_ENGINE` signals to perform. Do not attempt to retroactively synthesize
historical `CORE_ENGINE` signal rows from old `pattern_instances`; just start
writing them going forward from the day this ships.

---

## Tier 1 — foundational gaps (depends on §0.5 being merged)

### 1. Market regime / breadth gate

**Problem:** `resolve_signal` only looks at the individual symbol's own
`trend_state`. There is no check on the health of the market as a whole.

**Design — avoid a two-pass same-day dependency:** breadth for trading day D is
computed from the most recently *complete* prior EOD's stored `technical_snapshots`
(D-1 breadth gates D's signals) — not a same-run two-pass computation across
symbol batches that may span multiple GitHub Actions runs.

```python
# pipeline/protstock/market_regime.py
def compute_breadth(snapshots: Sequence[dict]) -> dict:
    """snapshots: one technical_snapshots row per symbol for a single trading date, timeframe='D'."""
    eligible = [s for s in snapshots if s.get("sma50") is not None]
    above = sum(1 for s in eligible if s["close"] > s["sma50"])
    return {"pct_above_sma50": (above / len(eligible) * 100) if eligible else None, "sample_size": len(eligible)}

def regime_ok(breadth: dict, vnindex_snapshot: dict, min_breadth_pct: float = 40.0) -> tuple[bool, list[str]]:
    reasons = []
    breadth_ok = breadth["pct_above_sma50"] is not None and breadth["pct_above_sma50"] >= min_breadth_pct
    index_ok = vnindex_snapshot.get("trend_state") != "DOWN"
    if not breadth_ok: reasons.append("MARKET_BREADTH_WEAK")
    if not index_ok: reasons.append("VNINDEX_DOWNTREND")
    return breadth_ok and index_ok, reasons
```

- New table `market_breadth_snapshots` (`trading_date`, `pct_above_sma50`,
  `sample_size`, `vnindex_trend_state`) for auditability.
- `resolve_signal` gains `market_context: dict | None`. Applied after the existing
  multi-timeframe gate, same short-circuit style: only downgrades `PROBE_BUY`/`ADD`
  to `WATCH`; never affects `EXIT`/`REDUCE`.
- Given §0.5, this now automatically reaches `signals` — no separate DSL
  reimplementation needed.

### 2. Zone confluence

`detect_zones` (`zones.py`) is implemented and stored to `support_resistance_zones`,
but `resolve_signal` never reads it.

```python
def zone_confluence_bonus(trigger_price: float, direction: str, zones: Sequence[dict], tolerance_pct: float = 0.02) -> tuple[float, str | None]:
    kind = "RESISTANCE" if direction == "BULLISH" else "SUPPORT"
    matches = [z for z in zones if z["zone_type"] == kind
               and z["lower_price"] * (1 - tolerance_pct) <= trigger_price <= z["upper_price"] * (1 + tolerance_pct)]
    if not matches: return 0.0, None
    best = max(matches, key=lambda z: z["strength"])
    return min(8.0, best["strength"] * 0.08), "ZONE_CONFLUENCE"
```

- Move the `detect_zones` call from `eod.py` into `analyze_bars` itself so the bonus
  can use it, and have `eod.py` reuse `result["zones"]` instead of calling it twice
  — same single-source-of-truth principle as the `relative_strength_market` fix.
- Apply the bonus to `quality_score` for `CONFIRMED` patterns before the
  bullish/bearish threshold checks. Cap the effective contribution so it tips close
  calls rather than manufacturing a signal on its own.

### 3. Journal-based feedback loop

- New table `signal_outcomes`: `signal_id` (FK to `signals`), `horizon_days` (5, 10,
  20), `forward_return_pct`, `max_drawdown_pct`, `hit_invalidation`, `evaluated_at`.
- New module `pipeline/protstock/outcomes.py`:
  `evaluate_signal_outcome(signal, price_history, horizon_days)` — pure function.
- New `cli.py` subcommand `evaluate-outcomes` (weekly batch job): pulls `signals`
  older than the largest horizon missing a `signal_outcomes` row, evaluates, upserts.
- Read query/view `pattern_precision_stats`: win rate and average forward return by
  `pattern_type` × `quality_score` band — for manual threshold recalibration, not
  automatic (a single personal trading history is too small a sample to safely
  auto-tune live thresholds; that's what Tier 2 §5's larger historical dataset is
  for). Since §0.5 makes `signals.action` the canonical decision, this now measures
  the actual system you're using, not a parallel DSL approximation of it.

---

## Tier 2 — smarter signal

### 4. Portfolio-level sector/correlation filter

- `resolve_signal` gains `portfolio_positions: list[dict] | None`,
  `candidate_sector: str | None`, `capital: float | None`.
- Reuse `risk.py::portfolio_exposure` for sector-weight aggregation.
- Applied only to `PROBE_BUY`/`ADD`, after every existing gate: if adding the
  candidate (sized via `risk.py::position_size`) would push its sector above
  `max_sector_weight_pct` (default `30.0`), downgrade to `WATCH` with reason
  `SECTOR_CONCENTRATION_LIMIT`.
- Fully opt-in: no `portfolio_positions` given → identical behavior to before.

### 5. Walk-forward parameter calibration

- New module `pipeline/protstock/calibrate.py`. Per `pattern_type`, build a DSL
  condition dict (`{"metric": "pattern", "op": "confirmed", "type": ...}`) and run
  `walk_forward_windows`/`run_backtest` (unmodified, from `backtest.py`) across the
  10-year universe history from §0.
- Sweep a small explicit grid (volume multiplier, quality threshold) per pattern
  type; select only on out-of-sample (test-window) metrics; report the winning
  combination **with its out-of-sample trade count next to it**, never silently.
- Standalone CLI research tool (`calibrate` subcommand) — not wired into the live
  EOD pipeline. Most useful once Tier 1's new gate thresholds
  (`min_breadth_pct`, `max_sector_weight_pct`) also need calibrating, so run this
  after Tier 1 is live for a while.

### 6. Candlestick evidence as a quality bonus

- New pure module `pipeline/protstock/candles.py`: `is_bullish_engulfing`,
  `is_pin_bar`, `is_doji`, at minimum.
- When the same bar used for the existing `_breakout_volume_ok` check also matches a
  candlestick pattern in the structural pattern's direction, add a small bonus
  (capped) to `_quality`'s score and append `"CANDLESTICK_CONFIRMATION"`.
- Hard constraint: a candlestick match alone must never flip `state` from `READY` to
  `CONFIRMED`, and must never be the sole reason behind a `PROBE_BUY`/`ADD` — it only
  adjusts the score of an already price-and-volume-confirmed structural pattern.

---

## Tier 3 — operational efficiency

### 7. Archive old FAILED/EXPIRED pattern evidence

- After §Tier-1-§3's outcome evaluation has scored a pattern's associated signals
  (or after a fixed retention window if it never produced a signal), null the
  `evidence` JSON on old `FAILED`/`EXPIRED` `pattern_instances` rows while keeping
  `pattern_type`, `state`, `quality_score`, dates intact.
- Explicit, manually-invoked (or scheduled-and-logged) CLI command — never a
  cascading delete trigger.

### 8. Telegram alert dedupe for repeated REDUCE

- Before sending a `REDUCE` alert, check the last N days (default 5) of
  `notification_deliveries`/`signals` for the same symbol + `REDUCE`; skip if
  already notified within the window. `EXIT` always sends regardless — escalation
  must never be suppressed by the dedupe window.

---

## Sequencing

1. §0 (data backfill split) — no dependencies, do first or in parallel with §0.5.
2. §0.5 (consolidate signal engines) — **do this before any Tier 1 item**; every
   Tier 1/2 gate is otherwise invisible in the live `signals` table.
3. Tier 1, in any order, once §0.5 is merged and §0's initial backfill has run
   (breadth/zone/outcome features all need real accumulated history to be
   meaningful).
4. Tier 2 §4 (portfolio filter) and §6 (candlestick) have no further dependency.
   §5 (calibration) is most useful after Tier 1 is live, since its parameter grid
   should eventually include Tier 1's new gate thresholds too.
5. Tier 3 §7 depends on Tier 1 §3 (`signal_outcomes` must exist first). §8 has no
   dependency and can be done anytime.
