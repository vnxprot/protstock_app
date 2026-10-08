import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateExRights } from '../src/lib/exRights.ts'

const base = { price: 30000, cash: 0, stockRate: 0, rightsRate: 0, rightsPrice: 0, splitRate: 1 }

test('cash, stock, rights and split use one combined ex-rights basis', () => {
  assert.equal(calculateExRights({ ...base, cash: 1000 }), 29000)
  assert.equal(calculateExRights({ ...base, stockRate: .2 }), 25000)
  assert.equal(calculateExRights({ ...base, rightsRate: .2, rightsPrice: 12000 }), 27000)
  assert.ok(Math.abs(calculateExRights({ ...base, cash: 1000, stockRate: .2, rightsRate: .2, rightsPrice: 12000 }) - 22428.57142857) < .001)
  assert.equal(calculateExRights({ ...base, splitRate: 2 }), 15000)
  assert.equal(calculateExRights({ ...base, splitRate: .5 }), 60000)
})

test('rejects unpriceable or impossible inputs', () => {
  assert.equal(calculateExRights({ ...base, cash: 30000 }), null)
  assert.equal(calculateExRights({ ...base, rightsRate: .2 }), null)
  assert.equal(calculateExRights({ ...base, stockRate: -.1 }), null)
  assert.equal(calculateExRights({ ...base, splitRate: 0 }), null)
})
