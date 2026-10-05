import test from 'node:test'
import assert from 'node:assert/strict'
import { displayStructureName, displaySystemRevision } from '../src/lib/releaseLabels.ts'

test('system presentation uses v1.0 while distinct Core Engines stay recognizable', () => {
  assert.equal(displayStructureName('Prot Core Engine v0.0'), 'Prot Core Engine · Mẫu hình v1.0')
  assert.equal(displayStructureName('Prot Core Engine v1.0'), 'Prot Core Engine · Nền tảng v1.0')
  assert.equal(displayStructureName('Prot Core Engine v2.0'), 'Prot Core Engine · Đa khung v1.0')
  assert.equal(displayStructureName('Prot Core Pack · VCP Breakout'), 'Prot Core Pack · VCP Breakout v1.0')
  assert.equal(displaySystemRevision('core-rules-v4.0.0'), 'v1.0')
  assert.equal(displaySystemRevision('health-v4.0.0'), 'v1.0')
  assert.equal(displaySystemRevision('MACD_BULLISH_DIVERGENCE_ZONE_V4'), 'v1.0')
})

test('unrelated and unknown revisions remain honest', () => {
  assert.equal(displayStructureName('My user rule v2.0'), 'My user rule v2.0')
  assert.equal(displaySystemRevision('custom-revision'), 'custom-revision')
  assert.equal(displaySystemRevision(null), 'Chưa ghi phiên bản')
})
