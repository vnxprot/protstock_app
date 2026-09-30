# Monthly–weekly–daily shadow rollout, 01/10/2026

## Production data repair

- Migration `20260930120000_price_provenance_and_outcome_status.sql` archived and divided 7,252 verified KBS raw-VND stock bars for six symbols by 1,000. Original rows remain in `price_revision_archive`.
- Legacy outcomes were marked `STALE`; the recalculation worker wrote 4,361 valid 5/10-session outcomes. No valid outcome has absolute forward return above 100% after repair. A 20-session cohort has not matured.
- One remaining historical discontinuity (TRC, 03/09/2026) is quarantined. `corporate_actions` contains no rows and `adjusted_close` has no coverage. Legacy price rows retain an unverified unit/version label unless individually audited.

## Shadow replay

- Version `MTF_FUNNEL_SHADOW_V1` evaluates closed monthly structure, a linked weekly setup with a 20-session life, and a first daily breakout/volume trigger.
- Replay from 01/01/2025 through 30/09/2026 covered 272 symbols, including inactive symbols: 111,980 assessments, 376 unique setup triggers across 150 symbols, and 20 quarantined assessments for one symbol.
- Matched 5/10/20-session outcomes matured for 373/369/362 triggers. These are close-to-close research outcomes before fees, slippage, taxes, and portfolio constraints; they are not a tradable backtest.

| Trigger year | 5-session mean | 10-session mean | 20-session mean | 20-session median |
| --- | ---: | ---: | ---: | ---: |
| 2025 | +0.95% | +1.21% | +2.41% | −0.15% |
| 2026 | −1.35% | −1.51% | −3.17% | −3.90% |

## Activation decision

Keep the new funnel in shadow. The 2026 cohort is weak even before trading costs, the prior live engine has no equivalent full-period replay, and corporate-action data is incomplete. Do not use the retrospective 2025–2026 series as an untouched out-of-sample win claim: the logic was designed after observing that period.

Before activation, obtain a versioned adjustment series or corporate-action ledger; replay the current engine and shadow funnel on identical symbol/date cohorts with next-session entry and costs; freeze parameters; then observe a prospective comparison. The shadow table and screen remain available for funnel counts and drop-off reasons without publishing buy or sell signals.
