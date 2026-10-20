import test from 'node:test'
import assert from 'node:assert/strict'
import { canslimChecks, emptyReview, reviewIsStale, safeSource, technicalFresh, validateReview } from '../src/lib/investmentModules.ts'
import { todayInVietnam } from '../src/lib/date.ts'

const day = todayInVietnam()
const row = { symbol_id: 1, as_of_date: day, source_revision: 'current', version: '1', evidence: { quality: 'VALID', setup: 'BREAKOUT', volume_ratio50: 1.8, rs_percentile: 90, cycle: { state: 'MARKUP', candidate: 'MARKUP' } } }
const market = { trading_date: day, coverage_status: 'COMPLETE', market_health_state: 'RISK_ON', vnindex_trend_state: 'UP' }
test('missing personal evidence never passes CAN SLIM', () => {
  const checks = canslimChecks(row, undefined, market, day, 'current')
  assert.deepEqual([checks.C, checks.A, checks.N, checks.I], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'])
  assert.deepEqual([checks.S, checks.L, checks.M], ['PASS', 'PASS', 'PASS'])
})
test('stale technical revisions and partial market coverage cannot pass', () => {
  assert.equal(technicalFresh(row, day, 'other'), false)
  assert.equal(canslimChecks(row, undefined, market, day, 'other').L, 'UNKNOWN')
  assert.equal(canslimChecks(row, undefined, { ...market, coverage_status: 'INCOMPLETE' }, day, 'current').M, 'UNKNOWN')
  assert.equal(canslimChecks({ ...row, evidence: { ...row.evidence, setup: 'OBSERVE' } }, undefined, market, day, 'current').S, 'UNKNOWN')
})
test('personal verification needs reporting period and a safe source', () => {
  const review = { ...emptyReview(1), c: 'PASS' }
  assert.match(validateReview(review), /Kỳ|kỳ/)
  assert.match(validateReview({ ...review, reporting_period: 'Q2/2026' }), /liên kết/)
  assert.equal(validateReview({ ...review, reporting_period: 'Q2/2026', source_url: 'https://example.org/report.pdf' }), null)
  assert.equal(safeSource('javascript:alert(1)'), null)
  assert.equal(safeSource('https://user:password@example.org'), null)
})
test('expired personal verification is visibly stale, never a fresh pass', () => {
  const review = { ...emptyReview(1), c: 'PASS', reviewed_on: '2020-01-01' }
  assert.equal(reviewIsStale(review), true)
  assert.equal(canslimChecks(row, review, market, day, 'current').C, 'STALE')
})
