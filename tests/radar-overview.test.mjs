import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isCurrentMacdLink, matchesRadarStage, radarOpportunityPriority } from '../src/lib/radarOverview.ts'

const row = (stage, entryStatus, milestones = []) => ({
  as_of_date: '2026-09-25', stage, entry_status: entryStatus, evidence: { milestones },
})

test('same-session breakout remains filterable after weekly confirmation overrides current stage', () => {
  const result = row('WEEKLY_CONFIRMED', 'RISK_WINDOW', [
    { date: '2026-09-25', kind: 'DAILY_BREAKOUT' },
    { date: '2026-09-25', kind: 'WEEKLY_CONFIRMED' },
  ])
  assert.equal(matchesRadarStage(result, 'ALL'), true)
  assert.equal(matchesRadarStage(result, 'DAILY_BREAKOUT'), true)
  assert.equal(matchesRadarStage(result, 'WEEKLY_CONFIRMED'), true)
  assert.equal(matchesRadarStage(result, 'REACCELERATING'), false)
})

test('old milestones do not appear as new in a later session', () => {
  const result = row('CONTINUING', 'NO_ENTRY', [{ date: '2026-09-22', kind: 'DAILY_BREAKOUT' }])
  assert.equal(matchesRadarStage(result, 'DAILY_BREAKOUT'), false)
  assert.equal(matchesRadarStage(result, 'CONTINUING'), true)
})

test('published buys lead while an extended reacceleration stays below fresh valid setups', () => {
  const fresh = row('WEEKLY_CONFIRMED', 'RISK_WINDOW', [{ date: '2026-09-25', kind: 'DAILY_BREAKOUT' }])
  const extended = row('REACCELERATING', 'EXTENDED', [{ date: '2026-09-25', kind: 'REACCELERATING' }])
  assert.ok(radarOpportunityPriority(fresh, []) < radarOpportunityPriority(extended, []))
  assert.equal(radarOpportunityPriority(extended, [{ action: 'PROBE_BUY' }]), 0)
  assert.ok(radarOpportunityPriority(row('NO_EVENT', 'NO_ENTRY'), [], { stage: 'WEEKLY_READY' })
    < radarOpportunityPriority(row('NO_EVENT', 'NO_ENTRY'), []))
})

test('MACD source link includes current watch and recent breakout, not old confirmation', () => {
  assert.equal(isCurrentMacdLink({ stage: 'WATCH_PRICE_CONFIRMATION', trigger_date: null }, '2026-10-07'), true)
  assert.equal(isCurrentMacdLink({ stage: 'CONFIRMED', trigger_date: '2026-10-07' }, '2026-10-07'), true)
  assert.equal(isCurrentMacdLink({ stage: 'CONFIRMED', trigger_date: '2026-10-02', evidence: { trigger_age_sessions: 4 } }, '2026-10-07'), true)
  assert.equal(isCurrentMacdLink({ stage: 'CONFIRMED', trigger_date: '2025-12-04', evidence: { trigger_age_sessions: 200 } }, '2026-10-07'), false)
  assert.equal(isCurrentMacdLink({ stage: 'INVALIDATED', trigger_date: '2026-10-07' }, '2026-10-07'), false)
})
