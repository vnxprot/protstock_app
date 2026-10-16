import test from 'node:test'
import assert from 'node:assert/strict'
import { signalHistoryRanges, signalHistoryWindow } from '../src/lib/signalHistoryRange.ts'

test('1D defaults to the latest published session, without broad history',()=>{
 assert.deepEqual(signalHistoryWindow('1D','2026-10-16'),{showHistory:false,dateFrom:'',dateTo:''})
 assert.deepEqual(signalHistoryRanges,['ALL','1D','7D','14D','30D','60D','90D','1Y'])
})
test('day windows include the latest session and cross calendar boundaries',()=>{
 assert.deepEqual(signalHistoryWindow('7D','2026-01-05'),{showHistory:true,dateFrom:'2025-12-30',dateTo:'2026-01-05'})
 for(const days of [7,14,30,60,90]){
  const range=signalHistoryWindow(`${days}D`,'2026-10-16')
  assert.equal((Date.parse(range.dateTo)-Date.parse(range.dateFrom))/86400000+1,days)
 }
})
test('all history removes bounds; custom dates remain under user control',()=>{
 assert.deepEqual(signalHistoryWindow('ALL','2026-10-16'),{showHistory:true,dateFrom:'',dateTo:''})
 assert.equal(signalHistoryWindow('CUSTOM','2026-10-16'),null)
 assert.equal(signalHistoryWindow('7D',null),null)
 assert.deepEqual(signalHistoryWindow('1Y','2026-10-16'),{showHistory:true,dateFrom:'2025-10-16',dateTo:'2026-10-16'})
})
