// Local browser smoke test. Every Supabase request is fulfilled by fixtures.
// Supply PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE when using a bundled runtime.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
async function main() {
  const base = process.env.PROT_TEST_URL || 'http://127.0.0.1:4180'
  assert(['127.0.0.1','localhost'].includes(new URL(base).hostname), 'Only a local development server is allowed')
  const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath:process.env.BROWSER_EXECUTABLE } : {}) })
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:1000}, reducedMotion:'reduce' }); page.setDefaultTimeout(12_000)
    const errors=[]; page.on('pageerror',e=>errors.push(e.message))
    const uid='11111111-1111-4111-8111-111111111111', date='2026-10-02'
    const symbol={id:1,symbol:'FPT',company_name:'FPT fixture',sector:'Công nghệ',exchange:'HOSE',active:true,trading_status:'NORMAL'}
    const profile={user_id:uid,username:'prot',full_name:'Prot',role:'ADMIN',status:'ACTIVE'}
    let v=1; let notes=[]; let hasThesis=true
    let watchItems=[{symbol:'FPT',tier:'A',addedAt:date+'T00:00:00Z',status:'On',reason:'Lý do cũ từ bảng',investmentHorizon:'Dài hạn',buyZone:'90–95',targetPrice:'120',stopLoss:'85'}]
    const version=()=>({id:v===1?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',version:v,thesis:v===1?'Luận điểm kiểm thử':'Luận điểm cập nhật',catalysts:'Tăng trưởng',invalidation_conditions:'Biên lợi nhuận giảm',risk_notes:'Giới hạn tỷ trọng',review_status:'MAINTAIN',created_at:date+'T08:00:00Z'})
    const signals=['D','W','M'].map((f,i)=>({id:'signal-'+i,symbol_id:1,symbol:'FPT',sector:symbol.sector,symbols:{symbol:'FPT',sector:symbol.sector},as_of_date:date,timeframe:f,composite_action:'WATCH',signal_state:'WATCH_CONTEXT',confluence_score:68,confluence_count:2,consensus_engines:['Prot Core Engine v2.0'],reasons:['MONTHLY_TREND_UP'],source_revision:'core-rules-v4.0.0'}))
    await page.route('**/*.supabase.co/**',async route=>{
      const req=route.request(), url=new URL(req.url()), name=url.pathname.split('/').pop(), accept=req.headers().accept||''; let body=[]
      if(name==='user')body={id:uid,email:'prot@protstock.local'}
      else if(name==='record_session_presence')body=null
      else if(name==='user_profiles')body=[profile]
      else if(name==='symbols')body=[symbol]
      else if(name==='user_watchlists')body=[{user_id:uid,items:watchItems,legacy_imported:true}]
      else if(name==='apply_watchlist_entry'){const args=req.postDataJSON();assert.equal(args.p_expected_user_id,uid);watchItems=watchItems.map(item=>item.symbol===args.p_symbol?{...item,...args.p_patch}:item);if(args.p_patch.targetPrice==='135')watchItems=watchItems.map(item=>({...item,reason:'Lý do thay đổi trên máy chủ'}));body=watchItems}
      else if(name==='daily_prices')body=[{symbol_id:1,trading_date:date,close:100,volume:1000000,quality_status:'VALID'}]
      else if(name==='technical_snapshots')body=[{symbol_id:1,timeframe:'D',as_of_date:date,algorithm_version:'core-rules-v4.0.0',macd:0.5,macd_signal:0.2}]
      else if(name==='watchlist_items')body=[{symbol:'FPT',tier:'A',added_at:date+'T00:00:00Z'}]
      else if(name==='job_runs')body=[{id:'job-1',status:'SUCCEEDED',trading_date:date,counts:{published_signals:3,covered_symbols:1,expected_symbols:1,publication_status:'COMPLETE'},source_revision:'core-rules-v4.0.0',finished_at:date+'T09:00:00Z',started_at:date+'T08:00:00Z',warnings:[]}]
      else if(name==='market_indices')body=[{id:1,code:'VNINDEX'}]
      else if(name==='market_index_prices')body=[{trading_date:date,close:url.searchParams.get('trading_date')?.startsWith('lt.')?1690:1700,source:'KBS'}]
      else if(name==='market_breadth_snapshots')body=[{trading_date:date,market_health_score:65,market_health_state:'RISK_ON',vnindex_trend_state:'UP',coverage_status:'COMPLETE',coverage_ratio:1,sample_size:1,observed_count:1,eligible_count:1,universe_size:1,pct_above_sma50:100,sector_breadth:[],health_method_version:'health-v4.0.0',health_components:{above_sma50:{value:100,valid_count:1,coverage_pct:100}}}]
      else if(name==='data_health_summary')body=[{active_symbols:1,latest_price_date:date,failed_jobs_7d:0,price_warnings:0,stale_jobs:0}]
      else if(name==='consolidated_signals')body=signals
      else if(name==='investment_theses')body=hasThesis?[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',user_id:uid,symbol_id:1,current_version_id:version().id,updated_at:date+'T08:00:00Z',symbols:{symbol:'FPT'}}]:[]
      else if(name==='investment_thesis_versions')body=[version()]
      else if(name==='save_investment_thesis'){assert.equal(req.postDataJSON().p_expected_user_id,uid); await new Promise(r=>setTimeout(r,600)); v=2; body=version().id}
      else if(name==='stock_analysis_data')body={symbol,prices:Array.from({length:40},(_,i)=>({trading_date:new Date(Date.UTC(2026,7,i+1)).toISOString().slice(0,10),open:90+i/5,high:91+i/5,low:89+i/5,close:90+i/5,volume:1000000})),technical:[{timeframe:req.postDataJSON().p_timeframe,as_of_date:date,algorithm_version:'core-rules-v4.0.0',close:100,trend_state:'UP',flow_state:'GREEN',flow_score:30,sma20:95,sma50:90,sma200:80,classical_candidates:[]}],decision:signals[0],patterns:[],zones:[],fundamentals:[],disclosures:[]}
      else if(name==='journal_entries'){if(req.method()==='POST'){const row=req.postDataJSON();notes=[row,...notes];body=row}else body=notes}
      else if(name==='search_consolidated_signals')body={total:3,rows:signals}
      if(accept.includes('vnd.pgrst.object+json')&&Array.isArray(body))body=body[0]||null
      await route.fulfill({status:200,headers:{'content-type':'application/json','content-range':'0-0/1','access-control-allow-origin':'*'},body:JSON.stringify(body)})
    })
    await page.addInitScript(({uid})=>{
      const exp=Math.floor(Date.now()/1000)+86400, b64=x=>btoa(JSON.stringify(x)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
      const token=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:uid,exp,role:'authenticated',session_id:'ui-fixture'})+'.fixture'
      localStorage.setItem('sb-upmqxwktvvguegqeqibn-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:uid,email:'prot@protstock.local',role:'authenticated',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:{}}}))
    },{uid})
    await page.goto(base+'/#analysis'); await page.getByRole('heading',{name:'Luận điểm đầu tư · FPT'}).waitFor()
    await page.getByRole('button',{name:'Cập nhật luận điểm',exact:true}).click()
    const area=page.locator('.thesis-form textarea').first(); await area.fill('Luận điểm cập nhật')
    await page.getByRole('button',{name:'Lưu phiên bản mới',exact:true}).click(); await page.waitForTimeout(100); assert(await area.isDisabled())
    await page.getByRole('button',{name:'Cập nhật luận điểm',exact:true}).waitFor(); await page.getByText('Luận điểm cập nhật',{exact:true}).waitFor()
    await page.setViewportSize({width:393,height:852}); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await page.getByRole('link',{name:'Ghi nhật ký nhanh',exact:true}).click(); const form=page.getByRole('dialog'); await form.waitFor()
    assert((await form.locator('input').evaluateAll(inputs=>inputs.map(input=>input.value))).includes('FPT'))
    if(process.env.PROT_TEST_SCREENSHOTS)await page.screenshot({path:process.env.PROT_TEST_SCREENSHOTS+'/v4-journal-mobile.png',fullPage:true})
    await page.keyboard.press('Escape'); assert.equal(await form.count(),0)
    await page.setViewportSize({width:1440,height:1000})
    await page.goto(base+'/#watchlist-board')
    const reason=page.getByRole('textbox',{name:'Lý do đầu tư FPT',exact:true})
    await reason.waitFor(); await reason.fill('Bản nháp chưa rời ô')
    await page.evaluate(async()=>{const api=await import('/src/lib/watchlist.ts');api.updateWatchlistItem('FPT',{targetPrice:'135'})})
    await page.getByRole('textbox',{name:'Mục tiêu FPT',exact:true}).waitFor()
    await page.waitForFunction(()=>document.querySelector('[aria-label="Mục tiêu FPT"]').value==='135')
    assert.equal(await reason.inputValue(),'Bản nháp chưa rời ô','ACK must not overwrite a dirty Board cell')
    assert.equal(await page.evaluate(uid=>localStorage.getItem('protstock-watchlist-field-draft:'+uid+':FPT:reason'),uid),'Bản nháp chưa rời ô')
    await reason.blur()
    hasThesis=false
    await page.goto(base+'/#watchlist')
    await page.locator('.watch-stock-why').getByText('Bản nháp chưa rời ô',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Chuyển FPT sang Off, giữ lý do trong bảng',exact:true}).click()
    assert.equal(await page.locator('.watch-stock').count(),0)
    await page.getByRole('link',{name:'Mở bảng Watchlist · Tier, lý do, vùng mua và On/Off',exact:true}).click()
    await page.getByRole('combobox',{name:'Tình trạng FPT',exact:true}).waitFor()
    assert.equal(await page.getByRole('combobox',{name:'Tình trạng FPT',exact:true}).inputValue(),'Off')
    assert.equal(await page.getByRole('textbox',{name:'Lý do đầu tư FPT',exact:true}).inputValue(),'Bản nháp chưa rời ô')
    assert.deepEqual(errors,[])
    console.log('PASS: authenticated fixtures, populated analysis/thesis, pinned owner, pending lock, v2 refresh iPhone quick journal, owner-pinned Watchlist, dirty Board ACK, legacy WHY fallback and Off retention')
  } finally { await browser.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
