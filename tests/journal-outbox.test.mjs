import test from 'node:test'
import assert from 'node:assert/strict'
import { queueJournalNote, readJournalOutbox, syncJournalOutbox, clearSavedJournalDrafts } from '../src/lib/journalOutbox.ts'

const contents=new Map()
globalThis.localStorage={getItem:key=>contents.get(key)??null,setItem:(key,value)=>contents.set(key,value),removeItem:key=>contents.delete(key),get length(){return contents.size},key:index=>[...contents.keys()][index]??null}
const note=(id,owner='owner-a')=>({id,user_id:owner,rationale:'Original note '+id,evidence_snapshot:{as_of_date:'2026-10-01',source_revision:'frozen'}})

test('offline journal notes survive failure and keep frozen evidence through retry',async()=>{
  contents.clear();queueJournalNote('owner-a',note('first'))
  await assert.rejects(syncJournalOutbox('owner-a',async()=>({error:{code:'network'}})))
  assert.equal(readJournalOutbox('owner-a').length,1)
  let submitted
  await syncJournalOutbox('owner-a',async payload=>{submitted=payload;return{error:null}})
  assert.equal(submitted.evidence_snapshot.source_revision,'frozen')
  assert.equal(readJournalOutbox('owner-a').length,0)
})

test('journal queues are isolated by account and reject a mismatched note owner',()=>{
  contents.clear();queueJournalNote('owner-a',note('first'))
  assert.deepEqual(readJournalOutbox('owner-b'),[])
  assert.throws(()=>queueJournalNote('owner-b',note('wrong')))
  assert.equal(readJournalOutbox('owner-a').length,1)
})

test('acknowledgement preserves a second note appended while synchronization is pending',async()=>{
  contents.clear();queueJournalNote('owner-a',note('first'))
  let acknowledge,started;const ready=new Promise(resolve=>{started=resolve})
  const seen=[]
  const sync=syncJournalOutbox('owner-a',async payload=>{
    seen.push(payload.id)
    if(payload.id==='first'){started();await new Promise(resolve=>{acknowledge=resolve})}
    return{error:null}
  })
  await ready;queueJournalNote('owner-a',note('second'));acknowledge();await sync
  assert.deepEqual(seen,['first','second'])
  assert.equal(readJournalOutbox('owner-a').length,0)
})

test('retrying a journal ID already saved on the server acknowledges it once',async()=>{
  contents.clear();queueJournalNote('owner-a',note('saved'))
  await syncJournalOutbox('owner-a',async()=>({error:{code:'23505'}}))
  assert.deepEqual(readJournalOutbox('owner-a'),[])
})

test('saving a note clears its drafts across changed symbols without erasing another draft',()=>{
  contents.clear()
  contents.set('protstock-journal-draft:owner-a:FPT',JSON.stringify({id:'saved',rationale:'one'}))
  contents.set('protstock-journal-draft:owner-a:HPG',JSON.stringify({id:'saved',rationale:'two'}))
  contents.set('protstock-journal-draft:owner-a:VNM',JSON.stringify({id:'other'}))
  contents.set('protstock-journal-draft:owner-b:FPT',JSON.stringify({id:'saved'}))
  clearSavedJournalDrafts('owner-a','saved')
  assert.equal(contents.has('protstock-journal-draft:owner-a:FPT'),false)
  assert.equal(contents.has('protstock-journal-draft:owner-a:HPG'),false)
  assert.equal(contents.has('protstock-journal-draft:owner-a:VNM'),true)
  assert.equal(contents.has('protstock-journal-draft:owner-b:FPT'),true)
})
