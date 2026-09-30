import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupSignals } from '../src/lib/signalTriage.ts'

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
