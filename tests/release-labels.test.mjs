import test from 'node:test'
import assert from 'node:assert/strict'
import { displayStructureName, displaySystemRevision } from '../src/lib/releaseLabels.ts'

test('current system presentation uses v0.0.0 while distinct Core Engines stay recognizable', () => {
  assert.equal(displayStructureName('Prot Core Engine v0.0'), 'Prot Core Engine · Mẫu hình v0.0.0')
  assert.equal(displayStructureName('Prot Core Engine v1.0'), 'Prot Core Engine · Nền tảng v0.0.0')
  assert.equal(displayStructureName('Prot Core Engine v2.0'), 'Prot Core Engine · Đa khung v0.0.0')
  assert.equal(displayStructureName('Prot Core Pack · VCP Breakout'), 'Prot Core Pack · VCP Breakout v0.0.0')
  assert.equal(displaySystemRevision('core-rules-v0.0.0'), 'v0.0.0')
  assert.equal(displaySystemRevision('health-v0.0.0'), 'v0.0.0')
  assert.equal(displaySystemRevision('MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0'), 'v0.0.0')
})

test('unrelated and unknown revisions remain honest', () => {
  assert.equal(displayStructureName('My user rule v2.0'), 'My user rule v2.0')
  assert.equal(displaySystemRevision('custom-revision'), 'custom-revision')
  assert.equal(displaySystemRevision('core-rules-v4.0.1'), 'core-rules-v4.0.1')
  assert.equal(displaySystemRevision(null), 'Chưa ghi phiên bản')
})
