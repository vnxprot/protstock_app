import test from 'node:test'
import assert from 'node:assert/strict'
import { portfolioTimeline, portfolioPerformance, realizedSlices, openCostBasis } from '../src/lib/portfolioLedger.ts'
import { tradeCosts } from '../src/lib/portfolioCosts.ts'

const trade = (id,date,action,quantity,price,symbol_id=1) => ({id,trading_date:date,created_at:date+'T09:00:00Z',action,quantity,price,symbol_id})
const report = (overrides={}) => ({portfolio:{capital:100000,created_at:'2026-09-01T01:00:00Z'},initial_capital:100000,transactions:[],capital_movements:[],prices:[],...overrides})
const price = (date,close,symbol_id=1) => ({symbol_id,trading_date:date,close})
const nearly = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-7,actual+' != '+expected)

test('does not apply a future purchase to earlier NAV dates',()=>{
  const history=portfolioTimeline(report({transactions:[trade('buy','2026-09-03','BUY_NEW',10,1000)],prices:[price('2026-09-01',1.4),price('2026-09-02',1.3),price('2026-09-03',1.1)]}))
  assert.equal(history[0].marketValue,0)
  assert.equal(history[1].nav,100000)
  assert.equal(history[2].cash,89985)
  assert.equal(history[2].nav,100985)
  nearly(history[2].value,0.985)
})

test('isolates external cash flows and uses historical quantities after a partial sale',()=>{
  const history=portfolioTimeline(report({
    portfolio:{capital:200000,created_at:'2026-09-01T01:00:00Z'},
    capital_movements:[{id:'deposit',movement_type:'DEPOSIT',amount:100000,effective_date:'2026-09-02'}],
    transactions:[trade('buy','2026-09-01','BUY_NEW',100,1000),trade('sell','2026-09-04','SELL_REDUCE',50,1200)],
    prices:[price('2026-09-01',1),price('2026-09-02',1),price('2026-09-03',1.1),price('2026-09-04',1.2)]
  }))
  assert.equal(history[1].nav,199850)
  nearly(history[1].value,-0.15)
  assert.equal(history[2].nav,209850)
  nearly(history[2].value,4.846247185389041)
  assert.equal(history[3].cash,159700)
  assert.equal(history[3].marketValue,60000)
  assert.equal(history[3].nav,219700)
  nearly(history[3].value,9.767550662997238)
})

test('weighted average realized P/L matches the position ledger rather than FIFO',()=>{
  const slices=realizedSlices([
    trade('sell2','2026-09-04','SELL_CLOSE',100,1700),
    trade('buy2','2026-09-02','BUY_ADD',100,2000),
    trade('buy1','2026-09-01','BUY_NEW',100,1000),
    trade('sell1','2026-09-03','SELL_REDUCE',100,1600)
  ])
  assert.equal(slices.sell1.costBasis,150225)
  assert.equal(slices.sell1.pnl,9375)
  assert.equal(slices.sell2.costBasis,150225)
  assert.equal(slices.sell2.pnl,19350)
})

test('full withdrawal and later deposit do not create artificial returns',()=>{
  const history=portfolioTimeline(report({capital_movements:[
    {id:'out',movement_type:'WITHDRAWAL',amount:100000,effective_date:'2026-09-02'},
    {id:'in',movement_type:'DEPOSIT',amount:50000,effective_date:'2026-09-03'}
  ]}))
  assert.equal(history[1].nav,0)
  assert.equal(history[1].dailyReturn,null)
  assert.equal(history[2].nav,50000)
  nearly(history[2].value,0)
})

test('marks missing and carried-forward prices so reports cannot silently claim full valuation',()=>{
  const history=portfolioTimeline(report({
    transactions:[trade('buy','2026-09-01','BUY_NEW',10,1000)],
    capital_movements:[{id:'review',movement_type:'DEPOSIT',amount:100,effective_date:'2026-09-03'}],
    prices:[price('2026-09-02',1.1)]
  }))
  assert.equal(history[0].missingPrices,1)
  assert.equal(history[0].marketValue,10015)
  assert.equal(history[1].missingPrices,0)
  assert.equal(history[2].stalePrices,1)
  assert.equal(history[2].marketValue,11000)
})

test('calculates the complete ledger beyond the REST 1000-row limit',()=>{
  const transactions=Array.from({length:1200},(_,index)=>trade('buy-'+String(index).padStart(5,'0'),'2026-09-01',index?'BUY_ADD':'BUY_NEW',1,1000))
  const history=portfolioTimeline(report({portfolio:{capital:2000000,created_at:'2026-09-01T01:00:00Z'},initial_capital:2000000,transactions,prices:[price('2026-09-01',1)]}))
  assert.equal(history[0].cash,797600)
  assert.equal(history[0].marketValue,1200000)
  assert.equal(history[0].nav,1997600)
})

test('applies rates from 1 September 2026, including a later dated change',()=>{
  const old = trade('old','2026-08-31','BUY_NEW',100,1000)
  const first = trade('first','2026-09-01','BUY_ADD',100,1000)
  const later = trade('later','2026-10-01','SELL_REDUCE',100,1200)
  const rates=[{effective_date:'2026-10-01',buy_fee_pct:0.2,sell_fee_pct:0.3,sell_tax_pct:0.1}]
  assert.deepEqual(tradeCosts(old,rates),{brokerFee:0,sellTax:0,total:0})
  assert.deepEqual(tradeCosts(first,rates),{brokerFee:150,sellTax:0,total:150})
  assert.deepEqual(tradeCosts(later,rates),{brokerFee:360,sellTax:120,total:480})
  assert.equal(realizedSlices([old,first,later],rates).later.pnl,19445)
})

test('actual fee and tax overrides replace estimates, including explicit zero',()=>{
  const buy={...trade('buy','2026-09-01','BUY_NEW',100,1000),broker_fee_override:87}
  const sell={...trade('sell','2026-09-02','SELL_CLOSE',100,1100),broker_fee_override:0,sell_tax_override:111}
  assert.deepEqual(tradeCosts(sell),{brokerFee:0,sellTax:111,total:111})
  assert.equal(realizedSlices([buy,sell]).sell.pnl,9802)
  assert.equal(openCostBasis([buy])['1']?.cost,100087)
  assert.equal(portfolioTimeline(report({transactions:[buy,sell],prices:[price('2026-09-01',1),price('2026-09-02',1.1)]})).at(-1).cash,109802)
})


test('portfolio creation uses the Vietnam day even after 17:00 UTC',()=>{
  const history=portfolioTimeline(report({portfolio:{capital:100000,created_at:'2026-10-01T17:30:00Z'},prices:[price('2026-10-01',1),price('2026-10-02',1)]}))
  assert.equal(history.length,1)
  assert.equal(history[0].date,'2026-10-02')
  assert.equal(history[0].nav,100000)
})

test('all three performance metrics are defined for a cash-only portfolio',()=>{
 const result=portfolioPerformance(report({as_of_date:'2026-09-03',market_sessions:['2026-09-01','2026-09-02','2026-09-03']}))
 assert.equal(result.profitLoss,0);assert.equal(result.todayProfitLoss,0);assert.equal(result.averageNetAssets,100000);assert.equal(result.averageSamples,3)
})
test('first-day purchase includes fees even without a previous valuation row',()=>{
 const result=portfolioPerformance(report({as_of_date:'2026-09-01',transactions:[trade('b','2026-09-01','BUY_NEW',10,1000)],prices:[price('2026-09-01',1)],market_sessions:['2026-09-01']}))
 assert.equal(result.profitLoss,-15);assert.equal(result.todayProfitLoss,-15);assert.equal(result.averageNetAssets,99985)
})
test('daily P/L excludes deposits; average NAV uses verified session closes',()=>{
 const result=portfolioPerformance(report({as_of_date:'2026-09-02',transactions:[{...trade('b','2026-09-01','BUY_NEW',10,1000),broker_fee_override:0}],capital_movements:[{id:'in',movement_type:'DEPOSIT',amount:100000,effective_date:'2026-09-02'}],prices:[price('2026-09-01',1),price('2026-09-02',1.1)],market_sessions:['2026-09-01','2026-09-02']}))
 assert.equal(result.profitLoss,1000);assert.equal(result.todayProfitLoss,1000);assert.equal(result.averageNetAssets,150500)
 nearly(result.todayReturnPct,0.5)
})
test('weekend valuation carries Friday close without reporting Friday P/L as today',()=>{
 const result=portfolioPerformance(report({portfolio:{capital:100000,created_at:'2026-10-16T01:00:00Z'},as_of_date:'2026-10-17',transactions:[trade('b','2026-10-16','BUY_NEW',10,1000)],prices:[price('2026-10-16',1.1)],market_sessions:['2026-10-16']}))
 assert.equal(result.complete,true);assert.equal(result.profitLoss,985);assert.equal(result.todayProfitLoss,0)
 assert.equal(result.averageSamples,1);assert.equal(result.averageNetAssets,100985)
})
test('missing latest session stays unavailable, but verified historical average remains visible',()=>{
 const result=portfolioPerformance(report({as_of_date:'2026-09-02',transactions:[trade('b','2026-09-01','BUY_NEW',10,1000)],prices:[price('2026-09-01',1)],market_sessions:['2026-09-01','2026-09-02']}))
 assert.equal(result.profitLoss,null);assert.equal(result.todayProfitLoss,null);assert.equal(result.averageNetAssets,99985)
 assert.equal(result.averageSamples,1);assert.equal(result.averageTotal,2)
})
test('zero remaining contributed capital does not erase realized investment profit',()=>{
 const result=portfolioPerformance(report({as_of_date:'2026-09-03',transactions:[trade('b','2026-09-01','BUY_NEW',10,1000),trade('s','2026-09-02','SELL_CLOSE',10,1200)],capital_movements:[{id:'out',movement_type:'WITHDRAWAL',amount:100000,effective_date:'2026-09-03'}],prices:[price('2026-09-01',1),price('2026-09-02',1.2)],market_sessions:['2026-09-01','2026-09-02','2026-09-03']}))
 assert.equal(result.latest.capital,0);assert.equal(result.profitLoss,1955);assert.equal(result.todayProfitLoss,0)
})
test('holder entitlement metadata does not block vendor-marked NAV',()=>{
 const result=portfolioPerformance(report({as_of_date:'2026-09-02',valuation_issues:[{symbol_id:1,symbol:'AAA',ex_date:'2026-09-02',action_type:'STOCK_DIVIDEND'}],valuation_blocked_symbols:[1],market_sessions:['2026-09-01','2026-09-02']}))
 assert.equal(result.profitLoss,0);assert.equal(result.todayProfitLoss,0)
 assert.equal(result.averageSamples,2)
})
test('adjusted historical quotes do not invalidate current cash P/L after a full sale',()=>{
 const result=portfolioPerformance(report({as_of_date:'2026-09-03',transactions:[{...trade('b','2026-09-01','BUY_NEW',10,1000),broker_fee_override:0},{...trade('s','2026-09-02','SELL_CLOSE',10,1100),broker_fee_override:0,sell_tax_override:0}],prices:[{...price('2026-09-01',0.5),valuation_usable:false}],market_sessions:['2026-09-01','2026-09-02','2026-09-03']}))
 assert.equal(result.profitLoss,1000);assert.equal(result.todayProfitLoss,0);nearly(result.returnPct,1)
 assert.equal(result.averageNetAssets,99000);assert.equal(result.averageSamples,3)
})


test('cash dividend receivable is separate from cash and converts once at net receipt',()=>{
 const base=report({as_of_date:'2026-10-16',portfolio:{capital:100000,created_at:'2026-10-01T01:00:00Z'},entitlements:[{symbol_id:1,symbol:'DGW',ex_date:'2026-10-05',action_type:'CASH_DIVIDEND',quantity:10,expected_cash:10000,source:'VCI_DIRECT_EVENTS'}],market_sessions:['2026-10-01','2026-10-05','2026-10-16']})
 const waiting=portfolioPerformance(base)
 assert.equal(waiting.latest.cash,100000);assert.equal(waiting.latest.receivables,10000);assert.equal(waiting.latest.nav,110000)
 const paid=portfolioPerformance({...base,dividend_receipts:[{id:'one',symbol_id:1,ex_date:'2026-10-05',received_date:'2026-10-16',net_cash:9500}]})
 assert.equal(paid.latest.cash,109500);assert.equal(paid.latest.receivables,0);assert.equal(paid.latest.nav,109500)
 assert.equal(paid.latest.capital,100000);assert.equal(paid.todayProfitLoss,-500)
})
