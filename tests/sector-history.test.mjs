import test from 'node:test'
import assert from 'node:assert/strict'
import { SECTOR_PERIODS, sectorEligible, sectorHistory, relativeSectorTurnover } from '../src/lib/sectorHistory.ts'

const day = (date, flow, health = 30, share = 10) => ({
  trading_date: date, universe_size: 10, observed_count: 10, eligible_count: 10,
  coverage_ratio: 1, coverage_status: 'COMPLETE', market_health_score: health,
  market_health_state: 'NEUTRAL', sector_breadth: [{
    sector: 'A', sample_size: 5, universe_count: 5, coverage_ratio: 1,
    market_health_score: health, flow_observed_count: 5, flow_coverage_ratio: 1,
    flow_median_score: flow, turnover_share_pct: share,
  }],
})

test('four periods use trading sessions rather than calendar days', () => {
  assert.deepEqual(Object.values(SECTOR_PERIODS).map(item => item.sessions), [5, 20, 60, 250])
})

test('Flow eligibility does not require a strong health score', () => {
  const snapshot = day('2026-09-29', 35, 20)
  assert.equal(sectorEligible(snapshot, snapshot.sector_breadth[0], 'flow'), true)
  snapshot.sector_breadth[0].flow_observed_count = 4
  assert.equal(sectorEligible(snapshot, snapshot.sector_breadth[0], 'flow'), false)
})

test('period statistics flag incomplete history instead of ranking it', () => {
  const rows = [day('2026-09-29', 40), day('2026-09-28', 30), day('2026-09-25', -10)]
  const summary = sectorHistory(rows, 'A', 'flow', 5)
  assert.equal(summary.complete, false)
  assert.equal(summary.persistencePct, 67)
  assert.equal(summary.scoreChange, 50)
})

test('relative turnover uses prior sessions, not the selected session in its baseline', () => {
  const rows = [day('2026-09-29', 20, 70, 20), ...Array.from({ length: 20 }, (_, i) => day(`2026-09-${String(28 - i).padStart(2, '0')}`, 10, 70, 10))]
  assert.equal(relativeSectorTurnover(rows, 'A'), 2)
})
