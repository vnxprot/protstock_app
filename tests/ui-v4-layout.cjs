// Local layout checks; Supabase requests are blocked with empty fixtures.
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
    await page.evaluate(async () => (await import('/tests/ui-v4-harness.tsx')).mountUiFixture('ADMIN'))
    const routes = ['today', 'watchlist', 'watchlist-board', 'journal', 'settings', 'analysis', 'screener', 'portfolio', 'backtest', 'rules', 'universe']
    const headings = { today: 'Tổng quan', watchlist: 'Những mã đáng để mắt tới', 'watchlist-board': 'Bảng Những mã để mắt tới', journal: 'Nhật ký quyết định', settings: 'Cài đặt', analysis: 'Phân tích mã', screener: 'Bộ lọc tín hiệu', portfolio: 'Danh mục', backtest: 'Kiểm thử lịch sử', rules: 'Thiết lập quy tắc', universe: 'Danh sách cổ phiếu' }
    let checks = 0
    for (const width of [393, 760, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 800 ? 852 : 1000 })
      for (const route of routes) {
        await page.evaluate(route => { location.hash = route }, route)
        await page.waitForFunction(heading => document.querySelector('#ui-test h1')?.textContent.trim() === heading, headings[route], { timeout: 10000 }).catch(async error => { throw new Error(`${route} at ${width}px: ${error.message}; headings=${JSON.stringify(await page.locator('#ui-test h1').allTextContents())}; pageErrors=${JSON.stringify(errors)}`) })
        await page.locator('#ui-test h1').first().waitFor()
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route}: overflow at ${width}px`)
        checks++
      }
    }
    await page.setViewportSize({ width: 393, height: 852 })
    assert.equal(await page.locator('#ui-test .personal-mobile-nav a').count(), 3)
    await page.locator('#ui-test button[aria-label="Tài khoản và thêm công cụ"]').click()
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.evaluate(async () => (await import('/tests/ui-v4-harness.tsx')).mountUiFixture('CLIENT'))
    await page.evaluate(() => { location.hash = 'journal' })
    await page.getByText('Tài khoản này chưa có quyền truy cập chức năng đã chọn.', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log(`PASS: ${checks} route/viewport checks, mobile account menu, and client role guard`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
