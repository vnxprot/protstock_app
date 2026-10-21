import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyInvestmentFilters, investmentRange, invalidInvestmentRange, matchesInvestmentFilters, investmentColumnValue, compareInvestmentColumn } from '../src/lib/investmentFilters.ts'
const item = { stock: { id: 1, symbol: 'MSH', company_name: 'May Sông Hồng', sector: 'DET MAY', exchange: 'HOSE', trading_status: 'NORMAL' }, fresh: true,
  row: { as_of_date: '2026-10-20', evidence: { setup: 'NEAR_PIVOT', rs_percentile: 88, distance_pct: -2, liquidity_vnd: 2_467_570_000, cycle: { state: 'ACCUMULATION', evidence_level: 'SUPPORTED', daily_event: null, weekly_date: '2026-10-16' } } }, review: { reviewed_on: '2026-10-05' }, checks: { C: 'PASS', A: 'UNKNOWN', N: 'STALE' } }
const matches = patch => matchesInvestmentFilters(item, { ...emptyInvestmentFilters(), ...patch }, ['MSH'])
test('all column filters compose and unknown values do not pass numeric ranges', () => {
  assert.equal(matches({ query: 'song hong', sector: 'DET MAY', exchange: 'HOSE', tradingStatus: 'NORMAL', watch: 'WATCHED', setup: 'NEAR_PIVOT', stage: 'ACCUMULATION', evidence: 'SUPPORTED', event: 'NONE', rsMin: '80', rsMax: '90', pivotMin: '-3', pivotMax: '0', liquidityMin: '2', liquidityMax: '3', checks: { C: 'PASS', A: 'UNKNOWN' } }), true)
  assert.equal(matches({ exchange: 'HNX' }), false)
  assert.equal(matches({ watch: 'UNWATCHED' }), false)
  assert.equal(matches({ checks: { A: 'PASS' } }), false)
  assert.equal(matches({ liquidityMin: '3' }), false)
  assert.equal(matchesInvestmentFilters({ ...item, fresh: false }, { ...emptyInvestmentFilters(), rsMin: '0' }, []), false)
})
test('date filtering distinguishes EOD, closed week and personal review dates', () => {
  const window = { dateFrom: '2026-10-15', dateTo: '2026-10-18' }
  assert.equal(matches({ ...window, dateBasis: 'as_of_date' }), false)
  assert.equal(matches({ ...window, dateBasis: 'weekly_date' }), true)
  assert.equal(matches({ ...window, dateBasis: 'reviewed_on' }), false)
  assert.equal(matches({ dateFrom: '2026-10-05', dateTo: '2026-10-05', dateBasis: 'reviewed_on' }), true)
  assert.equal(matchesInvestmentFilters({ ...item, review: undefined }, { ...emptyInvestmentFilters(), dateBasis: 'reviewed_on', dateFrom: '2026-01-01' }, []), false)
})
test('date presets anchor to published session and reversed bounds return no matches', () => {
  assert.deepEqual(investmentRange('1D', '2026-10-20'), { dateFrom: '2026-10-20', dateTo: '2026-10-20' })
  assert.deepEqual(investmentRange('7D', '2026-10-20'), { dateFrom: '2026-10-14', dateTo: '2026-10-20' })
  assert.equal(invalidInvestmentRange({ ...emptyInvestmentFilters(), rsMin: '90', rsMax: '80' }), true)
  assert.equal(matches({ dateFrom: '2026-10-21', dateTo: '2026-10-20' }), false)
})
test('Excel-style column selections compose and an empty selection excludes every row', () => {
  assert.equal(matches({ columns: { symbol: ['MSH'], stage: ['ACCUMULATION'], liquidity: ['2.5'] } }), true)
  assert.equal(matches({ columns: { symbol: ['HPG'] } }), false)
  assert.equal(matches({ columns: { stage: [] } }), false)
  assert.equal(matches({ columns: { watch: ['WATCHED'] } }), true)
  assert.equal(investmentColumnValue(item, 'liquidity', []).label, '2,5 tỷ')
  assert.equal(investmentColumnValue({ ...item, fresh: false }, 'rs', []).key, '__EMPTY__')
})
test('column sorting uses numbers and chronological dates, with empty values always last', () => {
  const value = (key, label = String(key)) => ({ key: String(key), label, value: key })
  assert.ok(compareInvestmentColumn(value(2), value(10), 'asc') < 0)
  assert.ok(compareInvestmentColumn(value(2), value(10), 'desc') > 0)
  assert.ok(compareInvestmentColumn(value('2026-09-30', '30/09/2026'), value('2026-10-01', '01/10/2026'), 'asc') < 0)
  assert.ok(compareInvestmentColumn(value(null, '—'), value(10), 'desc') > 0)
  assert.ok(compareInvestmentColumn(value('A'), value('Z'), 'asc') < 0)
})
