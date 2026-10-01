import test from 'node:test'
import assert from 'node:assert/strict'
import { isWatchActive, loadWatchlist, normalizeWatchlist, setWatchlistTier, toggleWatchlistSymbol, uniformIndex, updateWatchlistItem } from '../src/lib/watchlist.ts'

const contents = new Map()
globalThis.localStorage = {
  getItem: key => contents.get(key) ?? null,
  setItem: (key, value) => contents.set(key, value),
}
globalThis.CustomEvent = class CustomEvent extends Event {
  constructor(type, options) { super(type); this.detail = options?.detail }
}
globalThis.dispatchEvent = () => true

test('migrates legacy favorites to Tier B without losing order or duplicate protection', () => {
  contents.clear()
  contents.set('protstock-favorites', JSON.stringify(['MSB', 'HDB', 'MSB', 'bad symbol']))
  assert.deepEqual(loadWatchlist().map(item => [item.symbol, item.tier]), [['MSB', 'B'], ['HDB', 'B']])
  assert.ok(contents.has('protstock-watchlist-v1'))
})

test('Tier changes and On/Off stay synchronized with active favorites', () => {
  setWatchlistTier('MSB', 'S')
  assert.equal(loadWatchlist()[0].tier, 'S')
  toggleWatchlistSymbol('HDB')
  toggleWatchlistSymbol('PET')
  assert.deepEqual(loadWatchlist().map(item => item.symbol), ['PET', 'MSB', 'HDB'])
  assert.equal(loadWatchlist().find(item => item.symbol === 'HDB').status, 'Off')
  assert.deepEqual(JSON.parse(contents.get('protstock-favorites')), ['PET', 'MSB'])
  assert.equal(loadWatchlist()[1].tier, 'S')
  updateWatchlistItem('HDB', { reason: 'Giữ luận điểm đầu tư', buyZone: '24–25' })
  assert.equal(loadWatchlist().find(item => item.symbol === 'HDB').reason, 'Giữ luận điểm đầu tư')
  assert.deepEqual(loadWatchlist().filter(isWatchActive).map(item => item.symbol), ['PET', 'MSB'])
  setWatchlistTier('HDB', 'A')
  assert.equal(loadWatchlist().find(item => item.symbol === 'HDB').status, 'On')
  assert.equal(loadWatchlist().find(item => item.symbol === 'HDB').buyZone, '24–25')
})

test('invalid tiers default to B and malformed symbols are ignored', () => {
  assert.deepEqual(normalizeWatchlist([{ symbol: 'CTR', tier: 'X' }, { symbol: '<script>', tier: 'S' }]).map(item => [item.symbol, item.tier]), [['CTR', 'B']])
})

test('retired universe symbols are removed from local watchlists', () => {
  assert.deepEqual(normalizeWatchlist(['DHM', 'LTG', 'DMC', 'POS', 'MTA', 'AMC', 'DHD', 'DPC', 'PXS', 'SP2', 'TAR', 'TCD', 'TLG']).map(item => item.symbol), ['TLG'])
})

test('roulette rejects modulo-bias overflow before selecting an index', () => {
  const values = [0xffffffff, 5]
  assert.equal(uniformIndex(3, () => values.shift()), 2)
  assert.equal(values.length, 0)
  assert.equal(uniformIndex(1, () => 0), 0)
  assert.throws(() => uniformIndex(0, () => 0), RangeError)
})
