import test from 'node:test'
import assert from 'node:assert/strict'
import { quotedNetAssetValue } from '../src/lib/portfolioQuotes.ts'

test('weights include all quoted holdings and cash without depending on entitlement verification',()=>{
  const holdings=[{quantity:100,marketPrice:42000},{quantity:200,marketPrice:25000}]
  const nav=quotedNetAssetValue(holdings,800000)
  assert.equal(nav,10000000)
  assert.equal(holdings[0].quantity*holdings[0].marketPrice/nav*100,42)
})
test('a missing quote does not normalize remaining holdings or use their cost basis',()=>{
  assert.equal(quotedNetAssetValue([{quantity:100,marketPrice:null},{quantity:100,marketPrice:20000}],500000),null)
  assert.equal(quotedNetAssetValue([{quantity:100,marketPrice:0}],500000),null)
  assert.equal(quotedNetAssetValue([{quantity:100,marketPrice:20000}],null),null)
  assert.equal(quotedNetAssetValue([],500000),500000)
})
