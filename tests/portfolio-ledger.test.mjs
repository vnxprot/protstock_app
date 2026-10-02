import test from 'node:test'
import assert from 'node:assert/strict'
import { portfolioTimeline, realizedSlices } from '../src/lib/portfolioLedger.ts'

const trade = (id,date,action,quantity,price,symbol_id=1) => ({id,trading_date:date,created_at:date+'T09:00:00Z',action,quantity,price,symbol_id})
const report = (overrides={}) => ({portfolio:{capital:100000,created_at:'2026-09-01T01:00:00Z'},initial_capital:100000,transactions:[],capital_movements:[],prices:[],...overrides})
const price = (date,close,symbol_id=1) => ({symbol_id,trading_date:date,close})
const nearly = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-7,actual+' != '+expected)

test('does not apply a future purchase to earlier NAV dates',()=>{
  const history=portfolioTimeline(report({transactions:[trade('buy','2026-09-03','BUY_NEW',10,1000)],prices:[price('2026-09-01',1.4),price('2026-09-02',1.3),price('2026-09-03',1.1)]}))
  assert.equal(history[0].marketValue,0)
  assert.equal(history[1].nav,100000)
  assert.equal(history[2].cash,90000)
  assert.equal(history[2].nav,101000)
  nearly(history[2].value,1)
})

test('isolates external cash flows and uses historical quantities after a partial sale',()=>{
  const history=portfolioTimeline(report({
    portfolio:{capital:200000,created_at:'2026-09-01T01:00:00Z'},
    capital_movements:[{id:'deposit',movement_type:'DEPOSIT',amount:100000,effective_date:'2026-09-02'}],
    transactions:[trade('buy','2026-09-01','BUY_NEW',100,1000),trade('sell','2026-09-04','SELL_REDUCE',50,1200)],
    prices:[price('2026-09-01',1),price('2026-09-02',1),price('2026-09-03',1.1),price('2026-09-04',1.2)]
  }))
  assert.equal(history[1].nav,200000)
  nearly(history[1].value,0)
  assert.equal(history[2].nav,210000)
  nearly(history[2].value,5)
  assert.equal(history[3].cash,160000)
  assert.equal(history[3].marketValue,60000)
  assert.equal(history[3].nav,220000)
  nearly(history[3].value,10)
})

test('weighted average realized P/L matches the position ledger rather than FIFO',()=>{
  const slices=realizedSlices([
    trade('sell2','2026-09-04','SELL_CLOSE',100,1700),
    trade('buy2','2026-09-02','BUY_ADD',100,2000),
    trade('buy1','2026-09-01','BUY_NEW',100,1000),
    trade('sell1','2026-09-03','SELL_REDUCE',100,1600)
  ])
  assert.equal(slices.sell1.costBasis,150000)
  assert.equal(slices.sell1.pnl,10000)
  assert.equal(slices.sell2.costBasis,150000)
  assert.equal(slices.sell2.pnl,20000)
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
  assert.equal(history[0].marketValue,10000)
  assert.equal(history[1].missingPrices,0)
  assert.equal(history[2].stalePrices,1)
  assert.equal(history[2].marketValue,11000)
})

test('calculates the complete ledger beyond the REST 1000-row limit',()=>{
  const transactions=Array.from({length:1200},(_,index)=>trade('buy-'+String(index).padStart(5,'0'),'2026-09-01',index?'BUY_ADD':'BUY_NEW',1,1000))
  const history=portfolioTimeline(report({portfolio:{capital:2000000,created_at:'2026-09-01T01:00:00Z'},initial_capital:2000000,transactions,prices:[price('2026-09-01',1)]}))
  assert.equal(history[0].cash,800000)
  assert.equal(history[0].marketValue,1200000)
  assert.equal(history[0].nav,2000000)
})


test('portfolio creation uses the Vietnam day even after 17:00 UTC',()=>{
  const history=portfolioTimeline(report({portfolio:{capital:100000,created_at:'2026-10-01T17:30:00Z'},prices:[price('2026-10-01',1),price('2026-10-02',1)]}))
  assert.equal(history.length,1)
  assert.equal(history[0].date,'2026-10-02')
  assert.equal(history[0].nav,100000)
})
