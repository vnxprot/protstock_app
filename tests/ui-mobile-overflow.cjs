const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce' })
    await page.goto(process.env.PROT_TEST_URL || 'http://127.0.0.1:4183')
    await page.evaluate(async () => (await import('/tests/ui-v4-harness.tsx')).mountUiFixture('ADMIN'))
    let checks = 0
    for (const width of [320, 360, 393, 430, 760]) {
      await page.setViewportSize({ width, height: 852 })
      for (const route of ['today','market','analysis','screener','watchlist','watchlist-board','rules','backtest','portfolio','journal','settings','universe','admin']) {
        await page.evaluate(route => { location.hash = route }, route)
        await page.waitForTimeout(150)
        const result = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, shell: document.querySelector('#ui-test .app-shell')?.scrollWidth, scrollX }))
        assert(result.document <= width + 1 && result.shell <= width + 1 && result.scrollX === 0, `${route} at ${width}px: ${JSON.stringify(result)}`)
        checks++
      }
    }
    console.log(`PASS: ${checks} mobile page/width checks stay within viewport`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
