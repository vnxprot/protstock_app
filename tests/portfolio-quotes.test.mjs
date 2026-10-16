import test from 'node:test'
import assert from 'node:assert/strict'
import { holdingsNetAssetValue } from '../src/lib/portfolioQuotes.ts'

test('weights include all quoted holdings and cash without depending on entitlement verification',()=>{
  const holdings=[{marketValue:4200000},{marketValue:5000000}]
  const nav=holdingsNetAssetValue(holdings,800000)
  assert.equal(nav,10000000)
  assert.equal(holdings[0].marketValue/nav*100,42)
})
test('restores the original denominator including cost fallback position values and cash-only accounts',()=>{
  // PortfolioPage retains the original quantity * (marketPrice ?? averageCost) formula.
  assert.equal(holdingsNetAssetValue([{marketValue:100*15000},{marketValue:100*20000}],500000),4000000)
  assert.equal(holdingsNetAssetValue([],500000),500000)
  assert.equal(holdingsNetAssetValue([],0),0)
})
