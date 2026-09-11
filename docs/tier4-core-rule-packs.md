# Signal intelligence roadmap — Tier 4: Configurable Core Rule Packs

Status: DRAFT. Builds on `docs/signal-intelligence-roadmap-v2.md` (§0.5, Tier 1,
Tier 2 already merged). Design is based directly on `CORE_RULES.docx` (uploaded
proposal) — Part II of that document ("Chế độ bật/tắt nhiều Core Rule") is the
blueprint for this Tier; Part I (5 new rule types) is triaged into "build now"
(§3, Pullback Continuation — the document's own top priority) and "backlog" (§7).

**Why this also revises §0.5, not just adds to it:** §0.5 gave `resolve_signal`'s
decision a special bypass into `signals` (`rule_version_id` nullable, `source =
'CORE_ENGINE'`) because at the time there was exactly one hardcoded ladder and no
concept of multiple named, versioned engines. `CORE_RULES.docx` explicitly asks for
several such engines (Core v1, Core v2, Pullback Continuation, and more later), each
independently toggleable, each clearly labeled by source. Once there is more than
one "core" engine, the special-cased bypass is no longer simpler than just treating
each engine as an ordinary `rules` row — so this Tier folds the bypass away and
makes every signal source, system or user, go through the same table.

---

## 1. Schema: `rules` becomes engine-aware

New migration (do not edit `phase3_rules.sql` or the Tier 0.5 migration):

```sql
alter table public.rules add column if not exists kind text not null default 'USER_RULE'
  check (kind in ('CORE_PACK', 'USER_RULE'));
alter table public.rules add column if not exists pack_version text;
alter table public.rules add column if not exists notification_mode text not null default 'TELEGRAM'
  check (notification_mode in ('RECORD_ONLY', 'SCREENER', 'TELEGRAM'));
alter table public.rules add column if not exists blocks_new_entries boolean not null default false;
```

- `kind = 'CORE_PACK'` marks a system-authored, versioned engine (Core v1, Core v2,
  Pullback Continuation, and future packs from §7). `kind = 'USER_RULE'` is every
  Rule Studio rule a person writes — this is the existing default, so no existing
  row's meaning changes.
- `pack_version` is an immutable label (`"v1.0"`, `"v2.0"`) shown in the alert
  source string, per the doc's requirement that each pack carry a fixed version.
  Only set for `CORE_PACK` rows.
- `notification_mode` implements the doc's three delivery levels: `RECORD_ONLY`
  (stored for backtest/research only, never surfaced live), `SCREENER` (visible in
  the app's screener/UI, no Telegram push), `TELEGRAM` (also pushed). Existing rows
  default to `TELEGRAM`, preserving current behavior.
- `blocks_new_entries` marks a pack whose `WATCH` result should outrank another
  pack's `ADD`/`PROBE_BUY` for the same symbol/day in the priority combiner (§4) —
  this is the schema seat for the doc's "chặn rủi ro" tier between `REDUCE` and
  `ADD`, even though the pack that will actually use it (Core Event Risk) is
  deferred to §7. Reserving the column now avoids a second migration later.

**Enforcement:** wherever Rule Studio creates a `rules` row (the app's rule-creation
path, not necessarily in this pipeline repo), it must always insert `kind =
'USER_RULE'` explicitly and must never accept `kind` from user input. Add or verify
an RLS check/insert policy on `rules` that rejects `kind = 'CORE_PACK'` from any
role other than `service_role`, so a person can toggle a Core Pack's `status` (their
own row is never editable that way — see §5) but can never create or relabel one as
if it were a Core Pack.

---

## 2. Engine registry (replaces the `resolve_signal`-only path)

New dispatch point, e.g. `pipeline/protstock/engines.py`:

```python
def evaluate_named_engine(engine: str, overrides: dict, context: dict) -> tuple[bool, str, list[str]]:
    """context carries everything analyze_bars already computed: pattern_dicts,
    snapshot_dict, zones, position, market_context, multi_timeframe_context,
    portfolio_positions, candidate_sector, capital — never recomputed here."""
```

Registry:
- `"core_ladder_v2"` → calls today's `resolve_signal(patterns, snapshot, position,
  market_context=..., multi_timeframe_context=..., portfolio_positions=...,
  candidate_sector=..., capital=..., **overrides)` — the exact ladder from
  `pattern-engine-spec-addendum.md` and Tier 1/2, now parameterized instead of
  hardcoded, called through the registry instead of a special bypass.
- `"core_ladder_v1"` → new function `evaluate_core_v1(context)` that reproduces the
  four original seeded "Core v1" DSL rules' conditions (mua nền tích lũy, mua hai
  đáy, theo dõi setup, bán bearish) as one consolidated evaluator, so re-enabling
  "Core v1" is one toggle, not four separate rows with independent lifecycles. Do
  not resurrect the four original archived `rules` rows from Tier 0.5 — they stay
  archived/historical; this is a clean reimplementation under the new framework.
- `"pullback_continuation_v1"` → §3.
- No `engine` key present (or `engine == "custom"`) → fall through to today's
  `evaluate_rule(dsl, ...)` condition-matching, byte-for-byte unchanged. Every
  existing Rule Studio user rule keeps working with zero migration.

`_write_analysis` in `eod.py` stops writing a special `CORE_ENGINE` row directly
from `result["signal_preview"]`. Instead, the seeded "Prot Core Engine v2.0" row
(kind=`CORE_PACK`, engine=`core_ladder_v2`) flows through the **same** loop that
already evaluates `active_rules` today — it is simply one more row in that list,
dispatched through `evaluate_named_engine` instead of `evaluate_rule`. This removes
the asymmetry between "the one special engine" and "everything else."

**Migration safety note:** do not attempt to backfill or reassign historical
`signals` rows that already have `rule_version_id = null, source = 'CORE_ENGINE'`
from Tier 0.5 — there are very few of them (fresh Supabase, per
`signal-intelligence-roadmap-v2.md` §0's backfill status) and forcing that column
back to `NOT NULL` would require a data migration for no real benefit. Leave the
column nullable; simply stop writing new rows that way going forward. This mirrors
the same reasoning already used for `test_locked_universe` and the
`relative_strength_market` fix earlier in this project: prefer the safe, forward-only
change over a retroactive one when the historical data at stake is negligible.

---

## 3. Core Pullback Continuation v1.0 (the one new pack built in this Tier)

Per the proposal doc: monthly/weekly trend up, price pulls back to EMA20/SMA50 or a
strong support zone, then a daily bullish trigger appears — a complement to
breakout entries, since not every good entry is a new high.

New detector in `patterns.py`, same lifecycle shape as the existing five detectors
(`FORMING → READY → CONFIRMED`), so it plugs into the existing `_apply_zone_confluence`,
`invalidation_width_warning`, and `resolve_signal`-style consumption without new
special cases elsewhere:

```python
def detect_pullback_continuation(bars: Sequence[dict]) -> list[PatternCandidate]:
    """direction is always BULLISH; pattern_type = 'PULLBACK_CONTINUATION'."""
```

Conditions (tune exact numbers during calibration, §Tier2-§5 — these are starting
points, not final):
- Context: daily `trend_state == "UP"` from `calculate_indicators` (the stock is
  still in an uptrend on its own daily chart despite the pullback).
- Support test: `close` within `2%` of `ema20`, OR within `3%` of `sma50` — reuse
  the already-computed indicator snapshot, don't recompute EMA/SMA locally.
- Trigger bar: the most recent bar closes green (`close > open`) AND either matches
  a bullish candlestick pattern from `candles.py` (`is_bullish_engulfing` or
  `is_pin_bar`, both already built in Tier 2 §6), OR `volume_ratio20 >= 1.0` (a
  pullback's turn day doesn't need breakout-scale volume — it needs to not be on
  collapsing volume, which is a materially different, lighter bar than
  `_breakout_volume_ok`'s multipliers for the other five patterns; do not reuse
  those multipliers here, they'd make this pack indistinguishable from a breakout
  pattern and defeat the point of adding it).
- `state = CONFIRMED` when the trigger bar's conditions above are all met on the
  most recent bar; `READY` when price is in the support zone but the trigger bar
  hasn't appeared yet (mirrors the other detectors' `READY` semantics).
- `invalidation_price` = `sma50 * 0.97` (a close below this invalidates the
  pullback thesis — the stock broke the support it was supposed to be holding).
- `quality_score`: reuse the existing `_quality`-style scoring shape (a same-file
  helper, not a new scoring philosophy) — weight how tight the pullback is to the
  support level, how strong the prior uptrend was (e.g. distance above `sma200`
  before the pullback began), and candlestick confirmation as a bonus exactly like
  the other five detectors already treat it.

Seed one `CORE_PACK` row for this: `"Prot Core Pack · Pullback Continuation"`,
`pack_version = "v1.0"`, `engine = "pullback_continuation_v1"`, **`status =
'ARCHIVED'` (off) by default** — the proposal doc explicitly recommends this pack
start disabled until you choose to turn it on, unlike Trend Breakout/Core v2 which
stay on.

---

## 4. Priority combiner across packs and rules

Per the doc's fixed order: `EXIT → REDUCE → chặn rủi ro (blocks_new_entries WATCH)
→ ADD → PROBE_BUY → WATCH`. Multiple packs/rules can each independently produce
their own opinion for the same symbol/day (all stored — full transparency for
backtest/audit) but the app needs one *effective* call to show prominently and to
decide what to alert on.

Implement as a SQL view, no new table, using the existing `signals` + `rules`
join (works whether `rule_version_id` is set or, for old Tier-0.5-era rows, null):

```sql
create or replace view public.effective_signals as
select distinct on (signal.symbol_id, signal.timeframe, signal.as_of_date)
  signal.id as signal_id, signal.symbol_id, signal.timeframe, signal.as_of_date,
  signal.action, signal.source,
  rule.name as rule_name, rule.pack_version, rule.kind
from public.signals signal
left join public.rule_versions version on version.id = signal.rule_version_id
left join public.rules rule on rule.id = version.rule_id
order by signal.symbol_id, signal.timeframe, signal.as_of_date,
  case signal.action
    when 'EXIT' then 0
    when 'REDUCE' then 1
    else case when signal.action = 'WATCH' and coalesce(rule.blocks_new_entries, false) then 2
              when signal.action = 'ADD' then 3
              when signal.action = 'PROBE_BUY' then 4
              else 5 end
  end;
```

- `alerts.py` and any screener query should read from `effective_signals` for "what
  should I show/alert for this symbol today," while individual pack opinions remain
  queryable from `signals` directly for research/backtest.
- This enforces the doc's constraint that Rule Studio (`kind = 'USER_RULE'`) can
  never override a Core Pack's `EXIT`/`REDUCE`/risk-block: even if a user rule also
  fires `EXIT` for its own reasons, the view's `DISTINCT ON` ordering picks *a* row
  with the highest-priority action, and since `EXIT`/`REDUCE`/blocking-`WATCH` sit
  above `ADD`/`PROBE_BUY` regardless of `kind`, no `USER_RULE` result can ever
  "win" over a `CORE_PACK` result at a lower ordinal — a user rule can only ever
  contribute at the `ADD`/`PROBE_BUY`/plain-`WATCH` tier or below where Core Packs
  also sit at that tier, i.e. genuine ties broken arbitrarily by `DISTINCT ON`, but
  never a case where a Core Pack's more urgent signal is hidden by a less urgent
  user-rule one.

---

## 5. Notification mode wiring

- `alerts.py::send_eod_telegram_alerts` filters `effective_signals` joined back to
  `rules.notification_mode = 'TELEGRAM'` before sending — a `RECORD_ONLY` or
  `SCREENER` pack's result is stored and (for `SCREENER`) shown in-app, but never
  pushed to Telegram.
- No behavior change for existing rows: default `notification_mode = 'TELEGRAM'`
  keeps every existing pack/rule's alerts exactly as they are today.

---

## 6. Source labeling (per the doc: every signal states its origin plainly)

`alerts.py`'s message builder (already refactored in Tier 0.5 into
`build_telegram_message`) computes the label from `rules.kind`/`name`/`pack_version`
instead of the old `source` column:
- `kind == 'CORE_PACK'` → `f"{rule_name} {pack_version}"`, e.g. `"Prot Core Engine
  v2.0"`, `"Prot Core Pack · Pullback Continuation v1.0"`.
- `kind == 'USER_RULE'` → `f"Rule Studio: {rule_name}"`.
- Fallback (should not happen once §2 ships, kept only for defensive safety against
  any leftover null-FK row from before this Tier) → `"Prot Core Engine"` as today.

---

## 7. Backlog — triaged from `CORE_RULES.docx` Part I, not built in this Tier

Documented here so the roadmap doesn't lose them, each a future, separately
sequenced prompt once Tier 4 is stable:

- **Core Failed Breakout / Distribution** — detect a breakout that reverses back
  into its base on high volume, or repeated distribution days; feeds `REDUCE`/
  `WATCH`, not a new pattern lifecycle of its own. Natural next pack after Pullback
  Continuation.
- **Core Relative Strength Leader** — extend the existing VNINDEX relative-strength
  calculation with a sector benchmark (feasible now: `data/universe.csv` already
  carries a `sector` column per symbol — no new data source needed, just a
  sector-average-return aggregation alongside the existing benchmark comparison).
- **Core Event Risk** — warn on/block new entries near earnings, dividend, or share
  issuance events, using point-in-time official disclosure data. Partial foundation
  already exists (`disclosures.py` ingests HNX RSS disclosures with
  `published_at`/`available_from`), but needs a classification layer to identify
  *which* disclosures are earnings/dividend/issuance events specifically — that
  classification work isn't done yet. This is the pack that will actually use the
  `blocks_new_entries` column reserved in §1.
- **Core Position Defense** — ATR trailing stop, time-stop, and a defensive
  reduce/exit when a setup hasn't performed as expected after N sessions. Builds on
  `risk.py`'s existing ATR-based sizing.
- Explicitly **not recommended** (per the doc, and I agree): a mean-reversion /
  bottom-fishing pack — conflicts with the trend-following/breakout philosophy this
  whole engine is built around, and would need its own separate backtest validation
  before being anywhere near live signals.

## Sequencing

Tier 4 (this document) depends on Tier 1 and Tier 2 §4 (portfolio filter) already
being merged, since `core_ladder_v2`'s parameterized call needs all of
`resolve_signal`'s current keyword arguments to exist. §7's backlog items are each
independent of each other and can be sequenced in any order once Tier 4 ships.
