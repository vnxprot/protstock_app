import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { todayInVietnam } from '../src/lib/date.ts'
import { parseFeed } from '../api/collect-hnx.js'

test('personal calendar dates follow Vietnam across UTC midnight', () => {
  assert.equal(todayInVietnam(new Date('2026-10-01T17:01:00Z')), '2026-10-02')
  assert.equal(todayInVietnam(new Date('2026-10-01T16:59:00Z')), '2026-10-01')
})

test('an invalid RSS publication date cannot discard the remaining daily disclosures', () => {
  const item = date => `<item><title>FPT: Bao cao</title><guid>fpt-${date}</guid><link>https://exchange.example/news</link><pubDate>${date}</pubDate></item>`
  const rows = parseFeed(item('not-a-date') + item('2026-10-01T17:05:00Z'), 'HNX', new Map([['FPT', 1]]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].symbol_id, 1)
  assert.equal(rows[0].available_from, '2026-10-02')
})

function serviceWorker(fetchImpl) {
  const events = {}; const cachedShell = { offlineShell: true }
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, Response, fetch: fetchImpl,
    caches: { match: async path => path === '/' ? cachedShell : undefined },
    self: { location: { origin: 'https://personal.example' }, addEventListener: (name, handler) => { events[name] = handler }, skipWaiting() {}, clients: { claim() {} } },
  })
  return { handler: events.fetch, cachedShell }
}
test('offline API errors never receive a cached HTML shell', () => {
  const { handler } = serviceWorker(async () => { throw new Error('offline') })
  let intercepted = false
  const respondWith = () => { intercepted = true }
  handler({ request: { method: 'GET', url: 'https://personal.example/api/report', mode: 'cors' }, respondWith })
  handler({ request: { method: 'GET', url: 'https://database.example/rest/v1/journal', mode: 'cors' }, respondWith })
  assert.equal(intercepted, false)
})
test('offline navigation can still load the shell without caching personal API data', async () => {
  const { handler, cachedShell } = serviceWorker(async () => { throw new Error('offline') })
  let response
  handler({ request: { method: 'GET', url: 'https://personal.example/', mode: 'navigate' }, respondWith: promise => { response = promise } })
  assert.equal(await response, cachedShell)
})
