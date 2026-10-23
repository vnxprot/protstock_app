import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultConfig,evaluateRule,evaluate,validConfig,evaluateS} from '../src/lib/canslimWorkbench.ts'
const yearly=[2025,2024,2023,2022].map((year,i)=>({period:String(year),kind:'year',year,quarter:0,eps:[200,160,128,100][i]}))
test('four annual values are required for three consecutive growth rates',()=>{
 const r=defaultConfig().rules.find(r=>r.id==='a-eps')
 assert.equal(evaluateRule(yearly,r).status,'PASS')
 assert.equal(evaluateRule(yearly.slice(0,3),r).status,'UNKNOWN')
 assert.equal(evaluateRule(yearly.map(x=>({...x,eps:x.year===2023?0:x.eps})),r).status,'FAIL')
})
test('YoY matches exact calendar quarter rather than adjacent available row',()=>{
 const r=defaultConfig().rules[0]
 const rows=[{period:'2026-Q2',kind:'quarter',year:2026,quarter:2,eps:150},{period:'2025-Q1',kind:'quarter',year:2025,quarter:1,eps:100}]
 assert.equal(evaluateRule(rows,r).status,'UNKNOWN')
 rows.push({period:'2025-Q2',kind:'quarter',year:2025,quarter:2,eps:100})
 assert.equal(evaluateRule(rows,r).evidence[0].value,50)
 assert.equal(evaluateRule(rows,{...r,threshold:60}).status,'FAIL')
})
test('ROE point change differs from relative growth, negative denominator is not growth',()=>{
 const rows=[{period:'2025',kind:'year',year:2025,quarter:0,roe:18},{period:'2024',kind:'year',year:2024,quarter:0,roe:15}]
 const r={...defaultConfig().rules.at(-1),mode:'points',threshold:2}
 assert.equal(evaluateRule(rows,r).evidence[0].value,3)
 assert.ok(Math.abs(evaluateRule(rows,{...r,mode:'yoy'}).evidence[0].value-20)<1e-8)
 assert.equal(evaluateRule(rows.map(x=>({...x,roe:x.year===2024?-15:x.roe})),{...r,mode:'yoy'}).status,'UNKNOWN')
})
test('missing EPS TTM is never fabricated and disabled groups never count as passes',()=>{
 const c=defaultConfig();c.rules=c.rules.map(r=>({...r,enabled:false}));c.s.enabled=false
 assert.equal(evaluate(undefined,c).match,false)
 assert.equal(evaluateRule(yearly,{...defaultConfig().rules[0],kind:'ttm'}).status,'UNKNOWN')
})
test('configuration rejects impossible K/N and nonfinite input',()=>{
 const c=defaultConfig();assert.equal(validConfig(c),true)
 c.rules[0].required=2;assert.equal(validConfig(c),false)
 c.rules[0].required=1;c.s.base=NaN;assert.equal(validConfig(c),false)
})
test('illiquid flat series is not a valid contracted base',()=>{
 const bars=Array.from({length:100},(_,i)=>({date:String(i).padStart(3,'0'),open:100,high:100,low:100,close:100,volume:0}))
 assert.equal(evaluateS(bars,defaultConfig().s).status,'UNKNOWN')
})

test('breakout uses the pre-breakout contraction and excludes today from volume baseline',()=>{
 const c={...defaultConfig().s,mode:'breakout',liquidity:0}
 const bars=Array.from({length:110},(_,i)=>({date:String(i).padStart(3,'0'),open:100,high:i>=100?100.2:101,low:i>=100?99.8:99,close:100,volume:i>=100?100:1000}))
 bars.push({date:'110',open:101,high:103,low:101,close:102.5,volume:2000})
 const s=evaluateS(bars,c)
 assert.equal(s.status,'PASS')
 assert.equal(s.rows[4].value,.1)
 assert.ok(s.volumeRatio>2)
})
