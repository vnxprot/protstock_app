const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

async function main() {
  const base = process.env.PROT_TEST_URL || 'http://127.0.0.1:4184'
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath:process.env.BROWSER_EXECUTABLE } : {}) })
  try {
    const page = await browser.newPage({ viewport:{width:1366,height:768}, reducedMotion:'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const date = '2026-10-08'
    const symbol = { id:1, symbol:'FPT', company_name:'FPT', sector:'Công nghệ', exchange:'HOSE', trading_status:'NORMAL' }
    await page.route('**/*.supabase.co/**', async route => {
      const request = route.request(), name = new URL(request.url()).pathname.split('/').pop()
      let body = []
      if (name === 'symbols') body = [symbol]
      else if (name === 'job_runs') body = [{ trading_date:date, counts:{published_signals:1,publication_status:'COMPLETE'}, finished_at:`${date}T09:00:00Z`, source_revision:'fixture' }]
      else if (name === 'daily_prices') body = [{ trading_date:date, close:30, source:'KBS', price_unit:'THOUSAND_VND_PER_SHARE', quality_status:'VALID' }]
      else if (name === 'stock_analysis_data') body = { symbol, prices:[{trading_date:date,open:29,high:31,low:28,close:30,volume:1000000}], technical:[{timeframe:request.postDataJSON().p_timeframe,as_of_date:date,algorithm_version:'fixture',close:30,trend_state:'UP',flow_state:'GREEN',flow_score:20,classical_candidates:[]}], decision:null, patterns:[],zones:[],fundamentals:[],disclosures:[] }
      else if (name === 'user_watchlists') body = [{items:[],legacy_imported:true}]
      else if (name === 'data_health_summary') body = [{active_symbols:1,latest_price_date:date,failed_jobs_7d:0,price_warnings:0,stale_jobs:0}]
      else if (name === 'rules') body = []
      if (request.headers().accept?.includes('vnd.pgrst.object+json') && Array.isArray(body)) body = body[0] ?? null
      await route.fulfill({ status:200, headers:{'content-type':'application/json','content-range':'0-0/1','access-control-allow-origin':'*'}, body:JSON.stringify(body) })
    })
    await page.goto(`${base}/#analysis`)
    await page.evaluate(async () => (await import('/tests/ui-v4-harness.tsx')).mountUiFixture('ADMIN', true))
    await page.locator('#ui-test .stock-heading').waitFor()
    if (process.env.SCREENSHOT_DIR) await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/analysis-content-desktop.png`})
    assert.equal(await page.locator('#ui-test .symbol-picker').count(), 0)
    assert.equal(await page.locator('#ui-test .data-status-message').count(), 0)
    await page.getByRole('button', {name:'Thêm FPT vào Watchlist'}).click()
    await page.getByRole('button', {name:'Bỏ FPT khỏi Watchlist'}).waitFor()
    await page.locator('#ui-test .ex-rights-open').click()
    const dialog = page.getByRole('dialog', {name:'Giá sau chia'})
    await dialog.getByText('30.000 ₫', {exact:true}).waitFor()
    await dialog.locator('#ex-rights-cash').fill('10')
    await dialog.locator('.ex-rights-result strong').getByText('29.000 ₫').waitFor()
    await dialog.getByRole('combobox', {name:'Đơn vị cổ tức tiền mặt'}).click()
    await page.getByRole('option', {name:'đồng/CP'}).click()
    assert.equal(await dialog.locator('#ex-rights-cash').inputValue(), '1000')
    await page.keyboard.press('Escape')
    await page.setViewportSize({width:393,height:852})
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 393)
    if (process.env.SCREENSHOT_DIR) await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/analysis-content-mobile.png`})
    assert.deepEqual(errors, [])
    console.log('PASS: stock heading, Watchlist star, EOD calculator, dropdown, and mobile width')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
