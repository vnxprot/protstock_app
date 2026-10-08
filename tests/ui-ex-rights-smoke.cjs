const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

async function main() {
  const base = process.env.PROT_TEST_URL || 'http://127.0.0.1:4182'
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
  try {
    for (const width of [320, 393, 1366]) {
      const page = await browser.newPage({ viewport: { width, height: width > 760 ? 768 : 852 }, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${base}/#analysis`)
      await page.evaluate(async () => (await import('/tests/ui-v4-harness.tsx')).mountUiFixture('ADMIN'))
      await page.locator('#ui-test .ex-rights-open').waitFor()
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/analysis-page-${width}.png` })
      await page.locator('#ui-test .ex-rights-open').click()
      const dialog = page.getByRole('dialog', { name: 'Giá sau chia' })
      await dialog.waitFor()
      const firstRect = await dialog.boundingBox()
      if (width > 760) {
        assert.equal(await dialog.locator('.ex-rights-primary').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 3)
        assert(await dialog.locator('.ex-rights-body').evaluate(node => node.scrollHeight <= node.clientHeight + 1), 'Default desktop form should fit without scrolling')
      }
      await dialog.getByRole('button', { name: 'Sửa giá' }).click()
      await dialog.getByPlaceholder('Ví dụ: 30000').fill('30000')
      const inputs = dialog.locator('.ex-rights-fields input')
      await inputs.nth(0).fill('10')
      await inputs.nth(1).fill('20')
      await inputs.nth(2).fill('20')
      await inputs.nth(3).fill('12000')
      await dialog.locator('.ex-rights-result strong').getByText('22.428,57 ₫').waitFor()
      await dialog.locator('.ex-rights-body').evaluate(node => { node.scrollTop = node.scrollHeight })
      const lastRect = await dialog.boundingBox()
      assert(Math.abs(firstRect.x - lastRect.x) < 1 && Math.abs(firstRect.y - lastRect.y) < 1, `Dialog moved while scrolling at ${width}px`)
      assert.equal(await page.evaluate(() => scrollX), 0)
      const fits = await dialog.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 })
      assert(fits, `Dialog does not fit ${width}px viewport`)
      assert.deepEqual(errors, [])
      await page.screenshot({ path: process.env.SCREENSHOT_DIR ? `${process.env.SCREENSHOT_DIR}/ex-rights-${width}.png` : `ex-rights-${width}.png` })
      await page.close()
    }
    console.log('PASS: ex-rights calculator works, stays fixed, and fits mobile/desktop viewports')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
