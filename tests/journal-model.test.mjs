import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJournalCycles, cycleStatistics, newWorkflow, wilsonInterval, journalHref, journalConflict } from '../src/lib/journalModel.ts'

const tx=(id,action,quantity,price,date='2026-10-01',portfolio='p')=>({id,action,quantity,price,trading_date:date,created_at:date+'T10:00:00Z',symbol_id:1,portfolio_id:portfolio,symbols:{symbol:'AAA'},broker_fee_override:0,sell_tax_override:0})
const note=(id,execution,action='BUY',strategy='VCP')=>({id,symbol_id:1,decision:action,decision_date:'2026-10-01',created_at:'2026-10-01T09:00:00Z',linked_transaction_id:execution,workflow:{...newWorkflow(),strategy,version:'1',plan:{stop:90},classified_at:'2026-10-01T09:00:00Z'}})
test('opposing Champion exit and Challenger buy evidence stays explicit',()=>{
 assert.equal(journalConflict(null),null)
 assert.equal(journalConflict({signals:[{action:'WATCH'}],challenger:[{action:'PROBE_BUY'}]}),null)
 assert.match(journalConflict({signals:[{action:'EXIT'}],challenger:[{action:'PROBE_BUY'}]}),/Champion/)
})
test('partial exits and additions form one WAVG cycle; re-entry creates another',()=>{
 const rows=[tx('a','BUY_NEW',10,100),tx('b','BUY_ADD',10,120,'2026-10-02'),tx('c','SELL_REDUCE',5,130,'2026-10-03'),tx('d','SELL_CLOSE',15,100,'2026-10-04'),tx('e','BUY_NEW',4,90,'2026-10-05')]
 const cycles=buildJournalCycles(rows,[])
 assert.equal(cycles.length,2);assert.equal(cycles[0].pnl,-50);assert.equal(cycles[0].closedAt,'2026-10-04');assert.equal(cycles[1].quantity,4)
 assert.equal(cycleStatistics(cycles).n,1)
})
test('same symbol in different portfolios stays separate and actual costs take precedence',()=>{
 const rows=[tx('a','BUY_NEW',10,100),tx('b','BUY_NEW',10,100,'2026-10-01','q'),{...tx('c','SELL_CLOSE',10,120,'2026-10-02'),broker_fee_override:3,sell_tax_override:2}]
 const cycles=buildJournalCycles(rows,[])
 assert.equal(cycles.length,2);assert.equal(cycles[0].pnl,195);assert.equal(cycles[1].closedAt,null)
})
test('one primary entry and independent exit attribution; automatic trail never adds samples',()=>{
 const notes=[{...note('automatic',null),transaction_id:'a',workflow:null},note('entry','a'),note('exit','b','SELL','Core'),{...note('hold',null,'HOLD'),linked_cycle_id:'a'}]
 const [cycle]=buildJournalCycles([tx('a','BUY_NEW',10,100),tx('b','SELL_CLOSE',10,120,'2026-10-02')],notes)
 assert.equal(cycle.entry.id,'entry');assert.equal(cycle.exit.workflow.strategy,'Core');assert.equal(cycle.entries.length,4)
 assert.equal(cycleStatistics([cycle]).n,1);assert.equal(cycle.r,2)
})
test('R requires pre-trade risk on every purchase; late classification never gets R',()=>{
 const rows=[tx('a','BUY_NEW',10,100),tx('b','BUY_ADD',10,110,'2026-10-02'),tx('c','SELL_CLOSE',20,120,'2026-10-03')]
 assert.equal(buildJournalCycles(rows,[note('entry','a')])[0].r,null)
 const late=note('late','a');late.workflow.classified_at='2026-10-01T11:00:00Z'
 assert.equal(buildJournalCycles([rows[0],tx('d','SELL_CLOSE',10,120,'2026-10-02')],[late])[0].r,null)
})
test('closed samples include breakeven, exclude open and inconsistent cycles',()=>{
 const cycles=buildJournalCycles([tx('a','BUY_NEW',10,100),tx('b','SELL_CLOSE',10,100,'2026-10-02'),tx('c','BUY_NEW',10,100,'2026-10-03'),tx('d','SELL_CLOSE',11,120,'2026-10-04')],[])
 const result=cycleStatistics(cycles);assert.equal(result.n,1);assert.equal(result.wins,0);assert.equal(result.winRate,0);assert.equal(result.profitFactor,null)
})
test('Wilson interval reflects small samples and endpoints; launch context is URL encoded',()=>{
 assert.equal(wilsonInterval(0,0),null)
 const [lo,hi]=wilsonInterval(10,10);assert.ok(lo>70&&lo<75);assert.equal(hi,100)
 const href=journalHref({symbol:'AAA',strategy:'Core Pack · VCP',source:'RADAR',date:'2026-10-01'})
 const params=new URLSearchParams(href.split('?')[1]);assert.equal(params.get('strategy'),'Core Pack · VCP');assert.equal(params.get('date'),'2026-10-01')
})
