import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inFunnelGroup, sortFunnelRows, setupDate, funnelResult } from '../src/lib/challengerFunnel.ts'

const row = (symbol, stage, action = 'WATCH', extra = {}) => ({ symbol, action, reasons: [], evidence: { funnel_stage: stage, ...extra } })
test('fresh trigger stays first even when blocked to WATCH', () => {
  const fresh = { ...row('VCG', 'DAILY_TRIGGER'), reasons: ['REGIME_BLOCKED'] }
  const rows = [row('AAA', 'WEEKLY_READY'), row('BBB', 'TRIGGERED_EARLIER', 'PROBE_BUY'), fresh].sort(sortFunnelRows)
  assert.equal(rows[0], fresh)
  assert.equal(inFunnelGroup(fresh, 'ACTIVE'), true)
  assert.equal(inFunnelGroup(fresh, 'DAILY_TRIGGER'), true)
  assert.equal(funnelResult(fresh), 'Bối cảnh thị trường chưa cho phép')
})
test('active view excludes missing setup and quarantined data; all keeps them accessible', () => {
  for (const stage of ['MONTHLY_CONTEXT', 'DATA_QUARANTINED']) {
    assert.equal(inFunnelGroup(row('ABC', stage), 'ACTIVE'), false)
    assert.equal(inFunnelGroup(row('ABC', stage), 'ALL'), true)
  }
})
test('newer event first within group; missing setup never borrows assessment date', () => {
  const old = row('AAA', 'TRIGGERED_EARLIER', 'WATCH', { trigger_date: '2026-10-12' })
  const recent = row('ZZZ', 'TRIGGERED_EARLIER', 'WATCH', { trigger_date: '2026-10-14' })
  assert.deepEqual([old, recent].sort(sortFunnelRows), [recent, old])
  assert.equal(setupDate(row('ABC', 'MONTHLY_CONTEXT', 'WATCH', { assessment_date: '2026-10-15' })), null)
  assert.equal(setupDate(row('ABC', 'WEEKLY_READY', 'WATCH', { weekly: { date: '2026-10-09' } })), '2026-10-09')
})
