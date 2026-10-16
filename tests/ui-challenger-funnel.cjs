const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
async function main() {
  const base = process.env.PROT_TEST_URL || 'http://127.0.0.1:4181'
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*.supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto(base)
    for (const width of [1440, 393]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(async () => (await import('/tests/ui-challenger-funnel-harness.tsx')).mountFunnelFixture())
      const panel = page.locator('.challenger-funnel-panel')
      await panel.locator('.funnel-symbol').last().waitFor()
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
        // The first expansion, switching to the last stock and switching back
        // must keep the stock header and beginning of its own detail visible.
        for (const symbol of ['S02', 'S25', 'S24', 'S01']) {
          await panel.getByRole('button', { name: new RegExp(`^${symbol}`) }).click()
          const bounds = await panel.locator('.funnel-summary.is-expanded').evaluate(row => {
            const header = row.getBoundingClientRect()
            const detail = row.nextElementSibling.getBoundingClientRect()
            return { top: header.top, bottom: header.bottom, detailTop: detail.top, height: innerHeight }
          })
          assert(bounds.top >= 65 && bounds.bottom < bounds.height - 100, `${width}/${theme}/${symbol}: header out of view ${JSON.stringify(bounds)}`)
          assert(bounds.detailTop >= bounds.bottom - 1 && bounds.detailTop < bounds.height - 100)
          assert.equal(await panel.locator('.funnel-detail:visible').count(), 1)
        }
        const champion = page.locator('.signal-funnel-panel .signal-funnel-counts button').first()
        const challenger = panel.locator('.funnel-quick-groups button').first()
        const chipStyle = locator => locator.evaluate(el => { const s = getComputedStyle(el); return [s.height, s.borderRadius, s.fontSize, s.fontWeight] })
        assert.deepEqual(await chipStyle(challenger), await chipStyle(champion))
        await panel.getByRole('button', { name: 'Bộ lọc nâng cao', exact: true }).click()
        const heights = await panel.locator('.funnel-toolbar .screener-field, .funnel-toolbar .advanced-toggle, .funnel-advanced input, .funnel-advanced .soft-select-trigger, .funnel-advanced .secondary-button').evaluateAll(elements => elements.map(el => Math.round(el.getBoundingClientRect().height)))
        assert(heights.every(height => height === (width <= 760 ? 44 : 40)), `unaligned controls ${width}/${theme}: ${heights}`)
        const backgrounds = await panel.locator('.funnel-summary').evaluateAll(rows => rows.slice(1, 3).map(el => getComputedStyle(el).backgroundColor))
        assert.notEqual(backgrounds[0], backgrounds[1])
        await panel.getByRole('button', { name: 'Bộ lọc nâng cao', exact: true }).click()
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`)
      }
    }
    assert.deepEqual(errors, [])
    console.log('PASS: last-row expansion, switching rows, Champion chip parity, aligned controls, alternating rows; desktop/mobile and dark/light')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
