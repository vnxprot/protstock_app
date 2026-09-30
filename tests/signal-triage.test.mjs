import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterSignalGroups, groupSignals, signalGroupPage } from '../src/lib/signalTriage.ts'

const signal = (symbol_id, timeframe, action, reasons, state = 'WATCH_CONTEXT') => ({
  signal_id: `${symbol_id}-${timeframe}`, symbol_id, symbol: `S${symbol_id}`, sector: null,
  as_of_date: '2026-09-30', timeframe, action, state, score: 70, reasons,
})

test('groups timeframes by symbol and puts held risk first', () => {
  const rows = [
    signal(1, 'D', 'WATCH', ['TREND_UP'], 'WATCH_SETUP'),
    signal(1, 'W', 'WATCH', ['MONTHLY_BULLISH']),
    signal(2, 'D', 'WATCH', ['TREND_DOWN']),
  ]
  const groups = groupSignals(rows, [], new Set([2]))
  assert.equal(groups.length, 2)
  assert.equal(groups[0].symbol_id, 2)
  assert.equal(groups[0].risk, true)
  assert.equal(groups[1].signals.length, 2)
  assert.equal(groups[1].opportunity, true)
})

test('distinguishes changed actions and reasons from continuing signals', () => {
  const previous = [signal(1, 'D', 'WATCH', ['TREND_UP']), signal(2, 'D', 'WATCH', ['TREND_UP'])]
  const current = [signal(1, 'D', 'REDUCE', ['TREND_DOWN']), signal(2, 'D', 'WATCH', ['MONTHLY_BULLISH'])]
  const groups = groupSignals(current, previous, new Set())
  assert.equal(groups.find(group => group.symbol_id === 1)?.change, 'action')
  assert.equal(groups.find(group => group.symbol_id === 2)?.change, 'reasons')
  assert.equal(groupSignals(previous, previous, new Set())[0].change, 'continued')
  assert.equal(groupSignals(previous, null, new Set())[0].change, 'unknown')
})

test('keeps opposing WATCH evidence visible and never drops a source signal', () => {
  const rows = [signal(1, 'D', 'WATCH', ['TREND_UP', 'FLOW_BAR_SELLING_PRESSURE'], 'WATCH_SETUP'),
    signal(1, 'W', 'EXIT', ['STOP_INVALIDATED'])]
  const [group] = groupSignals(rows, [], new Set([1]))
  assert.equal(group.signals.length, 2)
  assert.equal(group.primary.action, 'EXIT')
  assert.equal(group.risk, true)
  assert.equal(group.opportunity, true)
})

test('orders changes, held risk, WATCH opportunity, then remaining groups', () => {
  const previous = [signal(1, 'D', 'WATCH', ['TREND_UP']),
    signal(2, 'D', 'WATCH', ['TREND_DOWN']),
    signal(3, 'D', 'WATCH', ['WEEKLY_BULLISH_SETUP'], 'WATCH_SETUP'),
    signal(4, 'D', 'WATCH', ['TREND_SIDEWAYS'])]
  const current = [signal(1, 'D', 'WATCH', ['MONTHLY_BULLISH']),
    ...previous.slice(1)]
  const groups = groupSignals(current, previous, new Set([2]))
  assert.deepEqual(groups.map(group => group.symbol_id), [1, 2, 3, 4])
  assert.deepEqual(filterSignalGroups(groups, 'changed', 'all').map(group => group.symbol_id), [1])
  assert.deepEqual(filterSignalGroups(groups, 'held_risk', 'all').map(group => group.symbol_id), [2])
  assert.deepEqual(filterSignalGroups(groups, 'opportunity', 'unheld').map(group => group.symbol_id), [3])
  assert.deepEqual(filterSignalGroups(groups, 'other', 'all').map(group => group.symbol_id), [4])
})

test('expanded view pages groups in sets of ten without dropping the last page', () => {
  const rows = Array.from({ length: 21 }, (_, index) => signal(index + 1, 'D', 'WATCH', ['TREND_SIDEWAYS']))
  const groups = groupSignals(rows, rows, new Set())
  assert.equal(signalGroupPage(groups, 1).length, 10)
  assert.equal(signalGroupPage(groups, 2).length, 10)
  assert.equal(signalGroupPage(groups, 3).length, 1)
  assert.equal(new Set([1, 2, 3].flatMap(page => signalGroupPage(groups, page).map(group => group.symbol_id))).size, 21)
})
