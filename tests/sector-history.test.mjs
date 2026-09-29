import test from 'node:test'
import assert from 'node:assert/strict'
import { sectorEligible } from '../src/lib/sectorHistory.ts'
import { calendarBounds, calendarKey, calendarLabel, sectorPeriodSummary } from '../src/lib/sectorCalendar.ts'

const day = (date, flow, health = 30, share = 10) => ({
  trading_date: date, universe_size: 10, observed_count: 10, eligible_count: 10,
  coverage_ratio: 1, coverage_status: 'COMPLETE', market_health_score: health,
  market_health_state: 'NEUTRAL', sector_breadth: [{
    sector: 'A', sample_size: 5, universe_count: 5, coverage_ratio: 1,
    market_health_score: health, flow_observed_count: 5, flow_coverage_ratio: 1,
    flow_median_score: flow, turnover_share_pct: share,
  }],
})

test('Flow eligibility does not require a strong health score', () => {
  const snapshot = day('2026-09-29', 35, 20)
  assert.equal(sectorEligible(snapshot, snapshot.sector_breadth[0], 'flow'), true)
  snapshot.sector_breadth[0].flow_observed_count = 4
  assert.equal(sectorEligible(snapshot, snapshot.sector_breadth[0], 'flow'), false)
})

test('calendar periods follow Monday weeks, real months, quarters and years', () => {
  assert.equal(calendarKey('2026-09-29', 'week'), '2026-09-28')
  assert.deepEqual(calendarBounds('2026-09-28', 'week'), { start: '2026-09-28', end: '2026-10-04' })
  assert.equal(calendarKey('2026-09-29', 'month'), '2026-09')
  assert.equal(calendarKey('2026-09-29', 'quarter'), '2026-Q3')
  assert.equal(calendarKey('2026-09-29', 'year'), '2026')
  assert.equal(calendarKey('2026-01-01', 'week'), '2025-12-29')
  assert.equal(calendarKey('2025-12-31', 'week'), calendarKey('2026-01-02', 'week'))
  assert.equal(calendarLabel('2026-Q3', 'quarter'), 'Quý III/2026')
  assert.equal(calendarBounds('2024-02', 'month').end, '2024-02-29')
})

test('period ranking uses a median, so one spike cannot dominate', () => {
  const rows = [day('2026-09-25', 10, 70), day('2026-09-28', 20, 75), day('2026-09-29', 100, 100)]
  const summary = sectorPeriodSummary(rows, rows.map(row => row.trading_date), 'A', 'flow')
  assert.equal(summary.score, 20)
  assert.equal(summary.lastValue, 100)
  assert.equal(summary.persistencePct, 100)
  assert.equal(summary.complete, true)
})

test('missing market sessions and thin Flow samples have distinct explanations', () => {
  const dates = ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29']
  assert.equal(sectorPeriodSummary([day(dates[4], 10)], dates, 'A', 'health').reason, 'Thiếu dữ liệu thị trường')
  const rows = dates.map(date => day(date, 10))
  rows[2].sector_breadth[0].flow_observed_count = 2
  rows[3].sector_breadth[0].flow_observed_count = 2
  assert.equal(sectorPeriodSummary(rows, dates, 'A', 'flow').reason, 'Ngành thiếu mẫu Flow')
  assert.equal(sectorPeriodSummary(rows, dates, 'A', 'health').complete, true)
})

test('weekend and holidays do not count as missing sessions', () => {
  const dates = ['2026-09-25', '2026-09-28', '2026-09-29']
  const rows = dates.map(date => day(date, 20, 70))
  const summary = sectorPeriodSummary(rows, dates, 'A', 'health')
  assert.equal(summary.expected, 3)
  assert.equal(summary.qualified, 3)
  assert.equal(summary.complete, true)
})
