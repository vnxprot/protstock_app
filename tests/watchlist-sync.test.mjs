import test from 'node:test'
import assert from 'node:assert/strict'
import { loadWatchlist, overlayWatchlist, readWatchlistOutbox, startWatchlistSync, stopWatchlistSync, setWatchlistTier, updateWatchlistItem, isWatchActive, toggleWatchlistSymbol, writeWatchlistOutbox } from '../src/lib/watchlist.ts'

const contents=new Map()
globalThis.localStorage={getItem:key=>contents.get(key)??null,setItem:(key,value)=>contents.set(key,value),removeItem:key=>contents.delete(key),get length(){return contents.size},key:index=>[...contents.keys()][index]??null}
globalThis.CustomEvent=class CustomEvent extends Event{constructor(type,options){super(type);this.detail=options?.detail}}
globalThis.dispatchEvent=()=>true
const settle=()=>new Promise(resolve=>setImmediate(resolve))
function mockClient(rows=new Map()){
  const client={offline:false,rows,
    from(){
      let owner
      return {
        select(){return this},eq(_key,value){owner=value;return this},
        async maybeSingle(){return client.offline?{data:null,error:{message:'offline'}}:{data:rows.get(owner)??null,error:null}},
        async single(){return client.offline?{data:null,error:{message:'offline'}}:{data:rows.get(owner)??null,error:null}},
        async insert(row){if(client.offline)return{error:{message:'offline'}};if(!rows.has(row.user_id))rows.set(row.user_id,{items:row.items,legacy_imported:true});return{error:null}}
      }
    },
    async rpc(name,args){
      assert.equal(name,'apply_watchlist_entry')
      if(args.p_expected_user_id!==client.owner)return{data:null,error:{message:'WATCHLIST_OWNER_MISMATCH'}}
      if(client.offline)return{data:null,error:{message:'offline'}}
      const row=rows.get(client.owner)
      const change={id:'server',symbol:args.p_symbol,patch:args.p_patch,addedAt:'2026-09-01'}
      row.items=overlayWatchlist(row.items,[change])
      return{data:structuredClone(row.items),error:null}
    }
  }
  return client
}

test('failed synchronization survives restart and replays the durable intent',async()=>{
  contents.clear()
  const rows=new Map([['owner-a',{items:[{symbol:'FPT',tier:'B',addedAt:'old'}],legacy_imported:true}]])
  const client=mockClient(rows);client.owner='owner-a'
  await startWatchlistSync('owner-a',client)
  client.offline=true
  toggleWatchlistSymbol('HPG')
  await settle()
  assert.equal(readWatchlistOutbox('owner-a').length,1)
  assert.deepEqual(loadWatchlist().map(item=>item.symbol),['HPG','FPT'])
  stopWatchlistSync('owner-a')
  const restarted=mockClient(rows);restarted.owner='owner-a'
  await startWatchlistSync('owner-a',restarted)
  assert.equal(readWatchlistOutbox('owner-a').length,0)
  assert.deepEqual(loadWatchlist().map(item=>item.symbol),['HPG','FPT'])
  assert.ok(rows.get('owner-a').items.some(item=>item.symbol==='HPG'))
  stopWatchlistSync('owner-a')
})

test('another account cannot consume a previous account outbox or local watchlist',async()=>{
  contents.clear()
  const rows=new Map([['owner-a',{items:[],legacy_imported:true}],['owner-b',{items:[],legacy_imported:true}]])
  const clientA=mockClient(rows);clientA.owner='owner-a'
  await startWatchlistSync('owner-a',clientA)
  clientA.offline=true;toggleWatchlistSymbol('HPG');await settle();stopWatchlistSync('owner-a')
  const clientB=mockClient(rows);clientB.owner='owner-b'
  await startWatchlistSync('owner-b',clientB)
  assert.deepEqual(loadWatchlist(),[])
  assert.equal(readWatchlistOutbox('owner-a').length,1)
  toggleWatchlistSymbol('VNM');await settle()
  assert.deepEqual(rows.get('owner-b').items.map(item=>item.symbol),['VNM'])
  stopWatchlistSync('owner-b')
  clientA.offline=false
  await startWatchlistSync('owner-a',clientA)
  assert.deepEqual(loadWatchlist().map(item=>item.symbol),['HPG'])
  assert.equal(readWatchlistOutbox('owner-a').length,0)
  stopWatchlistSync('owner-a')
})

test('server acknowledgement overlays subsequent pending changes instead of erasing optimistic edits',()=>{
  contents.clear()
  const changes=[
    {id:'change-1',symbol:'FPT',tier:'S',remove:false,addedAt:'old'},
    {id:'change-2',symbol:'HPG',tier:'A',remove:false,addedAt:'new'},
    {id:'change-3',symbol:'VNM',tier:'B',remove:true,addedAt:'old'}
  ]
  writeWatchlistOutbox('owner',changes)
  const restarted=readWatchlistOutbox('owner')
  const merged=overlayWatchlist([{symbol:'FPT',tier:'B',addedAt:'old'},{symbol:'VNM',tier:'B',addedAt:'old'}],restarted)
  assert.deepEqual(merged.filter(isWatchActive).map(item=>[item.symbol,item.tier]),[['HPG','A'],['FPT','S']])
  assert.equal(merged.find(item=>item.symbol==='VNM').status,'Off')
})


test('rapid offline add and Tier changes retain order and separate durable operations',async()=>{
  contents.clear()
  const rows=new Map([['owner-a',{items:[],legacy_imported:true}]])
  const client=mockClient(rows);client.owner='owner-a'
  await startWatchlistSync('owner-a',client)
  client.offline=true
  const originalNow=Date.now
  try {
    Date.now=()=>1790956800000
    toggleWatchlistSymbol('FPT')
    setWatchlistTier('FPT','A')
    setWatchlistTier('FPT','S')
  } finally { Date.now=originalNow }
  await settle()
  const pending=readWatchlistOutbox('owner-a')
  assert.deepEqual(pending.map(change=>change.patch.tier),['B','A','S'])
  assert.ok(pending.every((change,index)=>index===0 || change.queuedAt>pending[index-1].queuedAt))
  assert.equal([...contents.keys()].filter(key=>key.startsWith('protstock-watchlist-outbox-v1:owner-a:operation:')).length,3)
  stopWatchlistSync('owner-a')
  client.offline=false
  await startWatchlistSync('owner-a',client)
  assert.deepEqual(rows.get('owner-a').items.map(item=>[item.symbol,item.tier]),[['FPT','S']])
  assert.equal(readWatchlistOutbox('owner-a').length,0)
  stopWatchlistSync('owner-a')
})

test('an in-flight acknowledgement keeps operations appended while the request is pending',async()=>{
  contents.clear()
  const rows=new Map([['owner-a',{items:[],legacy_imported:true}]])
  const client=mockClient(rows);client.owner='owner-a'
  await startWatchlistSync('owner-a',client)
  const originalRpc=client.rpc.bind(client)
  let acknowledge, started
  const ready=new Promise(resolve=>{started=resolve})
  let first=true
  client.rpc=async(...args)=>{
    if(first){first=false;started();await new Promise(resolve=>{acknowledge=resolve})}
    return originalRpc(...args)
  }
  toggleWatchlistSymbol('FPT')
  await ready
  setWatchlistTier('FPT','S')
  toggleWatchlistSymbol('HPG')
  assert.equal(readWatchlistOutbox('owner-a').length,3)
  assert.deepEqual(loadWatchlist().map(item=>[item.symbol,item.tier]),[['HPG','B'],['FPT','S']])
  acknowledge()
  await settle();await settle()
  assert.equal(readWatchlistOutbox('owner-a').length,0)
  assert.deepEqual(loadWatchlist().map(item=>[item.symbol,item.tier]),[['HPG','B'],['FPT','S']])
  assert.deepEqual(rows.get('owner-a').items.map(item=>[item.symbol,item.tier]),[['HPG','B'],['FPT','S']])
  stopWatchlistSync('owner-a')
})


test('a damaged stored entry does not conceal other durable operations',()=>{
  contents.clear()
  contents.set('protstock-watchlist-outbox-v1:owner-a','{incomplete')
  contents.set('protstock-watchlist-outbox-v1:owner-a:operation:broken','{incomplete')
  contents.set('protstock-watchlist-outbox-v1:owner-a:operation:valid',JSON.stringify({id:'valid',symbol:'FPT',tier:'S',remove:false,addedAt:'2026-10-02',queuedAt:1}))
  assert.deepEqual(readWatchlistOutbox('owner-a').map(item=>item.id),['valid'])
})


test('deployed reason, plan and Off status survive durable synchronization and reactivation',async()=>{
  contents.clear()
  const legacy={symbol:'FPT',tier:'S',addedAt:'old',status:'On',reason:'Original investment thesis',investmentHorizon:'Long term',buyZone:'90-95',targetPrice:'120',stopLoss:'85'}
  const rows=new Map([['owner-a',{items:[legacy],legacy_imported:true}]])
  const client=mockClient(rows);client.owner='owner-a'
  await startWatchlistSync('owner-a',client)
  client.offline=true
  toggleWatchlistSymbol('FPT')
  updateWatchlistItem('FPT',{reason:'Updated legacy reason',targetPrice:'130'})
  await settle()
  assert.equal(loadWatchlist().filter(isWatchActive).length,0)
  assert.equal(loadWatchlist()[0].buyZone,'90-95')
  stopWatchlistSync('owner-a');client.offline=false
  await startWatchlistSync('owner-a',client)
  assert.equal(rows.get('owner-a').items[0].status,'Off')
  assert.equal(rows.get('owner-a').items[0].reason,'Updated legacy reason')
  assert.equal(rows.get('owner-a').items[0].targetPrice,'130')
  setWatchlistTier('FPT','A');await settle()
  assert.equal(rows.get('owner-a').items[0].status,'On')
  assert.equal(rows.get('owner-a').items[0].investmentHorizon,'Long term')
  assert.equal(rows.get('owner-a').items[0].stopLoss,'85')
  stopWatchlistSync('owner-a')
})


test('an account switch during a pending RPC cannot write into the new account',async()=>{
  contents.clear()
  const rows=new Map([['owner-a',{items:[],legacy_imported:true}],['owner-b',{items:[],legacy_imported:true}]])
  const client=mockClient(rows);client.owner='owner-a'
  await startWatchlistSync('owner-a',client)
  const originalRpc=client.rpc.bind(client)
  let release,started;const ready=new Promise(resolve=>{started=resolve})
  client.rpc=async(name,args)=>{assert.equal(args.p_expected_user_id,'owner-a');started();await new Promise(resolve=>{release=resolve});return originalRpc(name,args)}
  toggleWatchlistSymbol('FPT');await ready
  client.owner='owner-b';release();await settle()
  assert.deepEqual(rows.get('owner-b').items,[])
  assert.equal(readWatchlistOutbox('owner-a').length,1)
  stopWatchlistSync('owner-a');client.owner='owner-a';client.rpc=originalRpc
  await startWatchlistSync('owner-a',client)
  assert.equal(rows.get('owner-a').items[0].symbol,'FPT')
  assert.equal(readWatchlistOutbox('owner-a').length,0)
  stopWatchlistSync('owner-a')
})
