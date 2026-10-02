import test from 'node:test'
import assert from 'node:assert/strict'
import { journalContext, withEmotionTag } from '../src/lib/journalEvidence.ts'

const current={as_of_date:'2026-10-02',source_revision:'core-rules-v4.0.0',captured_at:'2026-10-02T08:00:00Z',signals:[{timeframe:'D',action:'ADD',state:'ACTIONABLE',score:80,reasons:['VOLUME']}]}
test('editing an old note preserves an unknown historical context instead of filling it with today data',()=>{
  assert.deepEqual(journalContext({evidence_snapshot:null,thesis_version_id:null},current,'new-thesis'),{evidence_snapshot:null,thesis_version_id:null})
})
test('editing a note keeps the original engine publication and thesis revision',()=>{
  const original={...current,as_of_date:'2026-09-01',source_revision:'previous'}
  assert.deepEqual(journalContext({evidence_snapshot:original,thesis_version_id:'old-thesis'},current,'new-thesis'),{evidence_snapshot:original,thesis_version_id:'old-thesis'})
})
test('a new note captures an independent copy of engine evidence',()=>{
  const original=structuredClone(current)
  const saved=journalContext(null,original,'thesis-2')
  original.signals[0].action='EXIT'
  assert.equal(saved.evidence_snapshot.signals[0].action,'ADD')
  assert.equal(saved.thesis_version_id,'thesis-2')
})
test('changing emotion preserves the existing lesson text and replaces only the emotion tag',()=>{
  assert.equal(withEmotionTag('Không mua đuổi. [emotion:FOMO]','DISCIPLINED'),'Không mua đuổi.\n[emotion:DISCIPLINED]')
  assert.equal(withEmotionTag(null,'FEAR'),'[emotion:FEAR]')
})
