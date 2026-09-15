// Run with Playwright available and PROT_TEST_PASSWORD in the environment.
// The replay endpoint is mocked: this test never queues a real workflow.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

async function main() {
  if (!process.env.PROT_TEST_PASSWORD) throw Error('PROT_TEST_PASSWORD is required')
  fs.mkdirSync('exports/ui', {recursive:true})
  const browser = await chromium.launch({headless:true,channel:'chrome'})
  try {
    const page = await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'})
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const base = process.env.PROT_TEST_URL || 'http://127.0.0.1:5174'
    await page.goto(base)
    await page.getByLabel('Tên đăng nhập',{exact:true}).fill('prot')
    await page.getByLabel('Mật khẩu',{exact:true}).fill(process.env.PROT_TEST_PASSWORD)
    await page.getByRole('button',{name:'Đăng nhập',exact:true}).click()
    await page.waitForSelector('.app-shell')
    await page.goto(`${base}/#screener`)
    await page.waitForSelector('.screener-row',{timeout:60000})
    await page.getByLabel('Tìm mã cổ phiếu',{exact:true}).fill('FPT')
    await page.waitForFunction(()=>[...document.querySelectorAll('.screener-symbol')].every(x=>x.textContent.startsWith('FPT')))
    await page.getByLabel('Tìm mã cổ phiếu',{exact:true}).click()
    assert.equal(await page.getByLabel('Tìm mã cổ phiếu',{exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'none')
    await page.getByRole('combobox',{name:'Tất cả bộ máy',exact:true}).click()
    const engines=await page.locator('.soft-select-menu [role="option"]').allTextContents()
    assert(engines.includes('Prot Core Pack · Relative Strength Leader'))
    assert(engines.includes('Prot Core Pack · RSI MACD Divergence'))
    assert(!engines.includes('Prot Core Pack · Phân kỳ RSI + xác nhận MACD'))
    await page.keyboard.press('Escape')
    await page.getByRole('combobox',{name:'Mọi khung',exact:true}).click()
    assert.equal(await page.locator('.soft-select-menu').evaluate(el=>getComputedStyle(el).borderWidth),'0px')
    await page.screenshot({path:'exports/ui/screener-dropdown.png'})
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
    assert.equal(await page.getByRole('combobox',{name:'Ngày (D)',exact:true}).count(),1)
    await page.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click()
    for (const width of [390,760,1024,1366]) {
      await page.setViewportSize({width,height:900})
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`screener overflow ${width}`)
    }
    await page.goto(`${base}/#analysis`)
    await page.getByText('Bản đồ vùng giá · khung D',{exact:true}).waitFor({timeout:60000})
    assert.equal(await page.getByText('Kháng cự gần giá',{exact:true}).count(),1)
    assert.equal(await page.getByText('Hỗ trợ gần giá',{exact:true}).count(),1)
    assert((await page.locator('.zone-group.resistance .zone-card').count())<=3)
    assert((await page.locator('.zone-group.support .zone-card').count())<=3)
    await page.screenshot({path:'exports/ui/zone-context.png'})
    await page.setViewportSize({width:390,height:900})
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'zone context mobile overflow')
    await page.setViewportSize({width:1366,height:900})
    await page.goto(`${base}/#backtest`)
    await page.getByRole('heading',{name:'Kiểm thử lịch sử',exact:true}).waitFor()
    assert.match(await page.locator('.rule-form').getByLabel('Từ ngày',{exact:true}).inputValue(),/^\d{2}\/\d{2}\/\d{4}$/)
    assert.match(await page.locator('.rule-form').getByLabel('Đến ngày',{exact:true}).inputValue(),/^\d{2}\/\d{2}\/\d{4}$/)
    await page.locator('.rule-form select').first().locator('option').nth(3).waitFor({state:'attached'})
    await page.getByRole('combobox',{name:'Chọn quy tắc đang bật',exact:true}).click()
    await page.screenshot({path:'exports/ui/backtest-dropdown.png'})
    const names=await page.getByRole('option').allTextContents()
    assert(names[1].includes('v0.0')&&names[2].includes('v1.0')&&names[3].includes('v2.0'))
    await page.keyboard.press('Escape')
    await page.goto(`${base}/#settings`)
    await page.getByRole('button',{name:'Tài khoản',exact:true}).click()
    let dispatches=0
    await page.route('**/api/rebuild-signals',async route=>{
      dispatches++
      assert.equal(route.request().postDataJSON().sendTelegram,false)
      assert.equal(route.request().postDataJSON().tradingDate,'2026-09-14')
      await route.fulfill({status:200,contentType:'application/json',body:'{}'})
    })
    await page.getByLabel('Ngày chạy lại tín hiệu',{exact:true}).fill('31/02/2026')
    await page.getByRole('button',{name:'Chạy lại tín hiệu',exact:true}).click()
    assert.equal(dispatches,0)
    await page.getByLabel('Ngày chạy lại tín hiệu',{exact:true}).fill('14/09/2026')
    await page.getByRole('button',{name:'Chạy lại tín hiệu',exact:true}).click()
    await page.getByText('Đã đưa vào hàng đợi. Pipeline tự xử lý; không cần bấm lại.').waitFor()
    assert.equal(dispatches,1)
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme)
      const colors=await page.evaluate(()=>[getComputedStyle(document.querySelector('.settings-page .timeframe-tabs .active')).backgroundColor,getComputedStyle(document.querySelector('.replay-submit')).backgroundColor])
      assert.equal(colors[0],colors[1])
      for (const width of [390,760,1024,1366]) {
        await page.setViewportSize({width,height:900})
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`settings overflow ${theme} ${width}`)
      }
    }
    await page.screenshot({path:'exports/ui/settings-final.png'})
    assert.deepEqual(errors,[])
    console.log('PASS: ticker filter, keyboard dropdown, shared engine order, invalid date blocked, Telegram off, light/dark and 390/760/1024/1366px layouts; no page errors.')
  } finally { await browser.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
