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
        // Expansion stays inline at the clicked stock; it must not scroll that
        // stock to the top of the viewport, even at the end of the list.
        for (const symbol of ['S02', 'S25', 'S24', 'S01']) {
          const button = panel.getByRole('button', { name: new RegExp(`^${symbol}`) })
          await button.scrollIntoViewIfNeeded()
          const before = await button.boundingBox()
          await button.click()
          const after = await button.boundingBox()
          assert(Math.abs(after.y - before.y) <= 1, `${width}/${theme}/${symbol}: stock jumped from ${before.y} to ${after.y}`)
          const summary = panel.locator('.funnel-summary.is-expanded')
          assert(await summary.evaluate(row => row.nextElementSibling.classList.contains('funnel-detail')))
          assert.equal(await panel.locator('.funnel-detail:visible').count(), 1)
          await button.click()
          assert.equal(await panel.locator('.funnel-detail:visible').count(), 0)
        }
        await panel.getByRole('button', { name: /^S24/ }).click()
        const next = panel.getByRole('button', { name: /^S25/ })
        await next.scrollIntoViewIfNeeded()
        const beforeSwitch = await next.boundingBox()
        await next.click()
        const afterSwitch = await next.boundingBox()
        assert(Math.abs(afterSwitch.y - beforeSwitch.y) <= 1, `switching rows jumped ${width}/${theme}: ${beforeSwitch.y} to ${afterSwitch.y}`)
        await next.click()
        const champion = page.locator('.signal-funnel-panel .signal-funnel-counts button').first()
        const challenger = panel.locator('.funnel-quick-groups button').first()
        const chipStyle = locator => locator.evaluate(el => { const s = getComputedStyle(el); return [s.height, s.borderRadius, s.fontSize, s.fontWeight] })
        assert.deepEqual(await chipStyle(challenger), await chipStyle(champion))
        const filterButton = panel.getByRole('button', { name: 'Bộ lọc', exact: true })
        assert.equal(await panel.locator('.funnel-quick-groups').getByRole('textbox', { name: 'Tìm mã phễu Challenger' }).count(), 1)
        assert.equal(await panel.locator('.funnel-quick-groups').getByRole('button', { name: 'Bộ lọc', exact: true }).count(), 1)
        const quickHeights = await panel.locator('.funnel-quick-groups button, .funnel-quick-groups .screener-field').evaluateAll(elements => elements.map(el => Math.round(el.getBoundingClientRect().height)))
        assert(quickHeights.every(height => height === (width <= 760 ? 44 : 36)), `unaligned quick filters ${width}/${theme}: ${quickHeights}`)
        await filterButton.click()
        assert.equal(await panel.locator('.funnel-advanced label').count(), 4)
        assert.equal(await panel.getByText('Xa stop tối đa %', { exact: true }).count(), 0)
        assert.equal(await panel.getByText('Lý do', { exact: true }).count(), 0)
        const heights = await panel.locator('.funnel-advanced .soft-select-trigger, .funnel-advanced .secondary-button').evaluateAll(elements => elements.map(el => Math.round(el.getBoundingClientRect().height)))
        assert(heights.every(height => height === (width <= 760 ? 44 : 40)), `unaligned controls ${width}/${theme}: ${heights}`)
        const backgrounds = await panel.locator('.funnel-summary').evaluateAll(rows => rows.slice(1, 3).map(el => getComputedStyle(el).backgroundColor))
        assert.notEqual(backgrounds[0], backgrounds[1])
        await filterButton.click()
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`)
      }
    }
    assert.deepEqual(errors, [])
    console.log('PASS: inline expansion without stock jumping, compact filter row, four filters, Champion chip parity; desktop/mobile and dark/light')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
