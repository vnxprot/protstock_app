import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Filter, MoreHorizontal, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAccountId } from '../hooks/useAccountId'
import { formatDate } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'
import { acknowledgeJournalNote, readJournalOutbox, queueJournalNote, syncJournalOutbox } from '../lib/journalOutbox'
import { useSymbols } from '../hooks/useStockAnalysis'
import { adherenceLabels, buildJournalCycles, entryStatus, journalActions, journalRoles, journalSources, journalStatuses, linkedTransaction, strategyName, type JournalEntry, type JournalLaunch, type JournalTransaction } from '../lib/journalModel'
import type { CostRate } from '../lib/portfolioCosts'
import { FeedbackToast, type FeedbackTone } from './FeedbackToast'
import { FilterField } from './FilterField'
import { DateField } from './DateField'
import { SoftSelect } from './SoftSelect'
import { ResearchPagination } from './ResearchPagination'
import { JournalForm } from './JournalForm'
import { JournalDetail } from './JournalDetail'
import { JournalReports } from './JournalReports'
import '../personal-workspace.css'
import './JournalPage.css'

function launchFromRoute():JournalLaunch|null {
  if(!location.hash.startsWith('#journal?'))return null
  const params=new URLSearchParams(location.hash.split('?')[1]??'')
  if(!params.get('symbol'))return null
  return Object.fromEntries([...params].filter(([key])=>['symbol','source','strategy','role','date','version'].includes(key))) as JournalLaunch
}
const emptyFilters={symbol:'',strategy:'',action:'',source:'',role:'',status:'',from:'',to:'',market:'',adherence:''}
export function JournalPage({authenticated}:{authenticated:boolean}) {
  const userId=useAccountId(authenticated),client=useQueryClient(),symbols=useSymbols(authenticated)
  const [tab,setTab]=useState<'timeline'|'cycles'|'reports'>('timeline'),[filters,setFilters]=useState(emptyFilters),[advanced,setAdvanced]=useState(false),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25)
  const [form,setForm]=useState<{editing:JournalEntry|null;launch:JournalLaunch|null;cycle?:string;pending?:boolean}|null>(null),[selected,setSelected]=useState<{entry?:string;cycle?:string}|null>(null)
  const [feedback,setFeedback]=useState<{text:string;tone:FeedbackTone}|null>(null),[queued,setQueued]=useState<JournalEntry[]>([]),[syncing,setSyncing]=useState(false)
  const notify=useCallback((text:string,tone:FeedbackTone='warning')=>setFeedback({text,tone}),[])
  const invalidate=useCallback(async()=>{await Promise.all([client.invalidateQueries({queryKey:['journal-workspace']}),client.invalidateQueries({queryKey:['journal-forward']})])},[client])
  const workspace=useQuery({queryKey:['journal-workspace',userId],enabled:Boolean(userId&&supabase),queryFn:async()=>{
    const entries:JournalEntry[]=[],transactions:JournalTransaction[]=[],rates:Record<string,CostRate[]>={}
    for(let offset=0;;offset+=500) {
      const {data,error}=await supabase!.from('journal_entries').select('*,symbols!inner(symbol,sector)').eq('user_id',userId!).order('decision_date',{ascending:false}).order('created_at',{ascending:false}).order('id').range(offset,offset+499)
      if(error)throw error
      entries.push(...(data??[]).map((item:any)=>({...item,symbols:Array.isArray(item.symbols)?item.symbols[0]:item.symbols})))
      if((data?.length??0)<500)break
    }
    for(let offset=0;;offset+=500) {
      const {data,error}=await supabase!.from('portfolio_transactions').select('id,portfolio_id,symbol_id,trading_date,created_at,action,quantity,price,stop_price,broker_fee_override,sell_tax_override,symbols(symbol,sector)').eq('user_id',userId!).order('trading_date').order('created_at').order('id').range(offset,offset+499)
      if(error)throw error
      transactions.push(...(data??[]).map((item:any)=>({...item,symbols:Array.isArray(item.symbols)?item.symbols[0]:item.symbols})))
      if((data?.length??0)<500)break
    }
    for(let offset=0;;offset+=500){
      const {data,error}=await supabase!.from('portfolio_cost_rates').select('portfolio_id,effective_date,buy_fee_pct,sell_fee_pct,sell_tax_pct,source_note').order('portfolio_id').order('effective_date').range(offset,offset+499)
      if(error)throw error
      for(const rate of data??[])(rates[rate.portfolio_id]??=[]).push(rate)
      if((data?.length??0)<500)break
    }
    return {entries,transactions,rates}
  }})
  const entries=workspace.data?.entries??[],transactions=workspace.data?.transactions??[]
  const cycles=useMemo(()=>buildJournalCycles(transactions,entries,workspace.data?.rates),[workspace.data])
  const matches=useCallback((entry:JournalEntry)=>{
    const w=entry.workflow
    return (!filters.symbol||(entry.symbols?.symbol??'').includes(filters.symbol.trim().toUpperCase()))
      && (!filters.strategy||strategyName(entry)===filters.strategy)&&(!filters.action||entry.decision===filters.action)
      && (!filters.source||(w?.source??(entry.transaction_id?'PORTFOLIO':'UNKNOWN'))===filters.source)
      && (!filters.role||(w?.role??'UNKNOWN')===filters.role)&&(!filters.status||entryStatus(entry)===filters.status)
      && (!filters.from||entry.decision_date>=filters.from)&&(!filters.to||entry.decision_date<=filters.to)
      && (!filters.market||entry.market_state===filters.market)&&(!filters.adherence||(w?.adherence??'UNKNOWN')===filters.adherence)
  },[filters])
  const filtered=entries.filter(matches),linkedIds=new Set(entries.flatMap(entry=>entry.linked_transaction_id?[entry.linked_transaction_id]:[]))
  const timeline=filtered.filter(entry=>!entry.transaction_id||!linkedIds.has(entry.transaction_id))
  const filteredCycles=cycles.filter(cycle=>cycle.entry?matches({...cycle.entry,decision_date:cycle.openedAt}):!Object.entries(filters).some(([key,value])=>value&&!['symbol','from','to'].includes(key))&&(!filters.symbol||cycle.symbol.includes(filters.symbol.trim().toUpperCase()))&&(!filters.from||cycle.openedAt>=filters.from)&&(!filters.to||cycle.openedAt<=filters.to))
  const visibleCycles=[...filteredCycles].reverse(),total=tab==='timeline'?timeline.length:visibleCycles.length,current=Math.min(page,Math.max(1,Math.ceil(total/pageSize)))
  const selectedEntry=selected?.entry?entries.find(entry=>entry.id===selected.entry)??null:null,selectedCycle=selected?.cycle?cycles.find(cycle=>cycle.id===selected.cycle)??null:null
  const cycleFor=(entry:JournalEntry)=>cycles.find(cycle=>cycle.id===entry.linked_cycle_id||cycle.transactions.some(tx=>tx.id===linkedTransaction(entry)))
  const change=(key:keyof typeof filters,value:string)=>{setFilters(previous=>({...previous,[key]:value}));setPage(1)}
  const closeForm=useCallback(()=>{setForm(null);if(location.hash.startsWith('#journal?'))history.replaceState(null,'','#journal')},[])
  const closeDetail=useCallback(()=>setSelected(null),[])
  useEffect(()=>{setForm(null);setSelected(null);setQueued(userId?readJournalOutbox<JournalEntry>(userId):[]);setFilters(emptyFilters);setPage(1)},[userId])
  useEffect(()=>{
    if(!userId)return
    const open=()=>{const launch=launchFromRoute();if(launch)setForm({editing:null,launch})}
    open();addEventListener('hashchange',open)
    const eventOpen=(event:Event)=>setForm({editing:null,launch:(event as CustomEvent<JournalLaunch>).detail??null})
    addEventListener('protstock:journal',eventOpen)
    return()=>{removeEventListener('hashchange',open);removeEventListener('protstock:journal',eventOpen)}
  },[userId])
  useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(null),5000);return()=>clearTimeout(timer)},[feedback])
  const syncQueue=useCallback(async()=>{
    if(!userId||!supabase)return
    setSyncing(true)
    try {
      await syncJournalOutbox<JournalEntry>(userId,async note=>{
        const result=await supabase!.from('journal_entries').insert(note)
        if(result.error?.code==='23505') {
          const existing=await supabase!.from('journal_entries').select('id').eq('id',note.id).eq('user_id',userId).maybeSingle()
          return existing.data?{error:null}:{error:{code:'LINK_CONFLICT'}}
        }
        return result
      });await invalidate()
    }catch{ /* Keep notes visible for recovery. */ }finally{setQueued(readJournalOutbox<JournalEntry>(userId));setSyncing(false)}
  },[userId,invalidate])
  useEffect(()=>{if(!userId)return;void syncQueue();const online=()=>void syncQueue();const storage=(event:StorageEvent)=>{if(event.key?.startsWith('protstock-journal-outbox:'+userId))void syncQueue()};addEventListener('online',online);addEventListener('storage',storage);return()=>{removeEventListener('online',online);removeEventListener('storage',storage)}},[userId,syncQueue])
  async function save(entry:JournalEntry) {
    if(!supabase||!userId||entry.user_id!==userId)throw new Error('Phiên tài khoản đã thay đổi. Mở lại Nhật ký để tiếp tục.')
    const payload={...entry,linked_cycle_id:entry.linked_cycle_id??form?.cycle??null}
    const {error}=form?.editing&&!form.pending?await supabase.from('journal_entries').update(payload).eq('id',entry.id).eq('user_id',userId).select('id').single():await supabase.from('journal_entries').insert(payload).select('id').single()
    if(error){
      if((!form?.editing||form.pending)&&(!error.code||error.message==='Failed to fetch')) {queueJournalNote(userId,payload);setQueued(readJournalOutbox<JournalEntry>(userId));notify('Đã lưu trên thiết bị, chờ đồng bộ. Chỉ tính thống kê sau khi đồng bộ.');return}
      throw new Error(error.code==='23505'?'Giao dịch hoặc mã ghi chép đã được liên kết. Tải lại Nhật ký để kiểm tra.':error.message.includes('immutable')?'Chiến lược và kế hoạch lịch sử đã khóa. Hãy tạo quyết định mới.':error.message.includes('HOLD requires')?'HOLD cần một vị thế đang có trong Danh mục.':error.message.includes('Execution')||error.message.includes('cycle')?'Kiểm tra mã, hướng giao dịch, ngày thực hiện và vòng giao dịch được chọn.':'Chưa lưu được quyết định. Kiểm tra kết nối, quyền tài khoản và thử lại.')
    }
    if(form?.pending){acknowledgeJournalNote(userId,entry.id);setQueued(readJournalOutbox<JournalEntry>(userId))}
    await invalidate();notify('Đã lưu quyết định và giữ bằng chứng lịch sử.','success')
  }
  async function remove(entry:JournalEntry){
    if(!supabase||!userId||entry.transaction_id||!confirm(`Xóa quyết định ${entry.symbols?.symbol??''}?`))return
    const {error}=await supabase.from('journal_entries').delete().eq('id',entry.id).eq('user_id',userId)
    if(error){notify('Chưa xóa được quyết định.','error');return}await invalidate();notify('Đã xóa quyết định.','success')
  }
  const edit=(entry:JournalEntry)=>{setSelected(null);setForm({editing:entry,launch:null})}
  const selector=(label:string,key:keyof typeof filters,options:Record<string,string>)=><label className="screener-field"><span className="sr-only">{label}</span><Filter size={15}/><SoftSelect aria-label={label} value={filters[key]} onChange={event=>change(key,event.target.value)}><option value="">{label}</option>{Object.entries(options).map(([value,text])=><option key={value} value={value}>{text}</option>)}</SoftSelect></label>
  const advancedSelector=(label:string,key:keyof typeof filters,options:Record<string,string>)=><FilterField label={label}><SoftSelect aria-label={label} value={filters[key]} onChange={event=>change(key,event.target.value)}><option value="">Tất cả</option>{Object.entries(options).map(([value,text])=><option key={value} value={value}>{text}</option>)}</SoftSelect></FilterField>
  const pagination=<ResearchPagination label={`Phân trang ${tab==='timeline'?'nhật ký':'vòng giao dịch'}`} page={current} pageSize={pageSize} total={total} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/>
  return <section className="workspace-page journal-page journal-workspace">
    <div className="page-title-row"><div><h1>Nhật ký</h1><p className="muted">Tín hiệu → quyết định → giao dịch → kết quả.</p></div><div className="watch-detail-actions"><a className="secondary-button" href="#settings?guide=journal">Hướng dẫn</a><button className="primary-button" disabled={!userId} onClick={()=>setForm({editing:null,launch:null})}><Plus size={16}/> Ghi quyết định</button></div></div>
    <div className="timeframe-tabs" role="tablist" aria-label="Nhật ký">{([['timeline','Dòng thời gian'],['cycles','Vòng giao dịch'],['reports','Hiệu quả']] as const).map(([key,label])=><button key={key} id={`journal-tab-${key}`} role="tab" aria-selected={tab===key} aria-controls="journal-content" className={tab===key?'active':''} onClick={()=>{setTab(key);setPage(1)}}>{label}</button>)}</div>
    {queued.length>0&&<article className="panel" role="status"><div className="panel-title"><h2>{queued.length} quyết định chờ đồng bộ</h2><button className="secondary-button" disabled={syncing} onClick={()=>void syncQueue()}>{syncing?'Đang đồng bộ…':'Thử đồng bộ'}</button></div>{queued.map(note=><div key={note.id}><p>{symbols.data?.find(stock=>stock.id===note.symbol_id)?.symbol??'Mã'} · {journalActions[note.decision]} · {note.workflow?.strategy||'Chưa xác định'} · {note.rationale}</p><button type="button" className="text-button" disabled={syncing} onClick={()=>setForm({editing:{...note,symbols:{symbol:symbols.data?.find(stock=>stock.id===note.symbol_id)?.symbol??''}},launch:null,pending:true})}>Sửa liên kết và thử lưu</button></div>)}</article>}
    <div className="panel journal-toolbar"><div className="journal-filter-row"><label className="screener-field screener-search"><Search size={15}/><input aria-label="Tìm mã Nhật ký" type="search" value={filters.symbol} onChange={event=>change('symbol',event.target.value)} placeholder="Tìm mã…"/></label>{selector('Chiến lược','strategy',Object.fromEntries([...new Set(entries.map(strategyName))].map(value=>[value,value])))}{selector('Hành động','action',Object.fromEntries(Object.keys(journalActions).map(key=>[key,key])))}<button type="button" className="secondary-button" aria-expanded={advanced} onClick={()=>setAdvanced(value=>!value)}><SlidersHorizontal size={15}/> Bộ lọc{Object.values(filters).filter(Boolean).length?` (${Object.values(filters).filter(Boolean).length})`:''}</button>{Object.values(filters).some(Boolean)&&<button className="text-button" onClick={()=>{setFilters(emptyFilters);setPage(1)}}>Xóa lọc</button>}</div>
      {advanced&&<div className="journal-filter-advanced aligned-filters"><DateField label="Từ ngày" value={filters.from} onChange={value=>change('from',value)}/><DateField label="Đến ngày" value={filters.to} onChange={value=>change('to',value)}/>{advancedSelector('Nguồn','source',journalSources)}{advancedSelector('Vai trò','role',journalRoles)}{advancedSelector('Trạng thái','status',journalStatuses)}{advancedSelector('Tuân thủ','adherence',adherenceLabels)}{advancedSelector('Thị trường','market',Object.fromEntries([...new Set(entries.map(entry=>entry.market_state).filter((value):value is string=>Boolean(value)))].map(value=>[value,value])))}</div>}
      <div className="journal-summary"><span>Đang mở <strong>{filteredCycles.filter(cycle=>!cycle.closedAt).length}</strong></span><span>Đã đóng <strong>{filteredCycles.filter(cycle=>cycle.closedAt).length}</strong></span><span>Đăng ký đánh giá <strong>{filtered.filter(entry=>entry.workflow?.evaluation&&entryStatus(entry)!=='CANCELLED').length}</strong></span><span>Lãi/lỗ đã thực hiện <strong className={filteredCycles.filter(cycle=>!cycle.invalid).reduce((sum,cycle)=>sum+cycle.pnl,0)<0?'negative':'positive'}>{workspace.isSuccess?formatVnd(filteredCycles.filter(cycle=>!cycle.invalid).reduce((sum,cycle)=>sum+cycle.pnl,0)):'—'}</strong></span></div>
    </div>
    <div id="journal-content" role="tabpanel" aria-labelledby={`journal-tab-${tab}`}>
      {!userId?<article className="panel"><p>Đăng nhập để xem Nhật ký cá nhân.</p></article>:workspace.isLoading?<article className="panel" role="status">Đang tải Nhật ký và sổ giao dịch…</article>:workspace.isError?<article className="panel form-error" role="alert">Chưa tải được Nhật ký hoặc chi phí danh mục. <button className="text-button" onClick={()=>void workspace.refetch()}>Thử lại</button></article>:tab==='reports'?<JournalReports userId={userId} cycles={filteredCycles} entries={filtered} onOpenCycle={id=>setSelected({cycle:id})}/>:tab==='cycles'?<article className="panel"><div className="panel-title"><h2>Vòng giao dịch</h2><span>{visibleCycles.length} vòng</span></div><p className="muted">Bộ lọc áp dụng theo quyết định entry. Mua lại sau khi thoát hết tạo vòng mới; lãi/lỗ vòng mở chỉ gồm phần đã bán.</p><div className="journal-table-wrap"><table className="journal-table"><thead><tr><th>Mã · ngày mở</th><th>Entry → exit</th><th>Trạng thái</th><th>Lãi/lỗ ròng đã thực hiện</th><th>R</th></tr></thead><tbody>{visibleCycles.slice((current-1)*pageSize,current*pageSize).map(cycle=><tr key={cycle.id}><td><button className="text-button" onClick={()=>setSelected({cycle:cycle.id})}>{cycle.symbol}</button><small>{formatDate(cycle.openedAt)}</small></td><td>{strategyName(cycle.entry)} → {cycle.closedAt?strategyName(cycle.exit):'Chưa thoát'}</td><td>{cycle.invalid?'Cần kiểm tra sổ':cycle.closedAt?`Đã đóng ${formatDate(cycle.closedAt)}`:`Đang giữ ${cycle.quantity} CP`}</td><td className={cycle.pnl<0?'negative':'positive'}>{cycle.invalid?'—':formatVnd(cycle.pnl)}</td><td>{cycle.r?.toFixed(2)??'—'}</td></tr>)}</tbody></table></div>{!visibleCycles.length&&<p className="muted">Chưa có vòng giao dịch khớp bộ lọc.</p>}{pagination}</article>:<article className="panel journal-timeline-panel"><div className="panel-title"><h2>Dòng thời gian</h2><span>{timeline.length} sự kiện</span></div>{!timeline.length?<div className="empty-state"><BookOpen size={24}/><p>{entries.length?'Không có quyết định khớp bộ lọc.':'Ghi quyết định đầu tiên hoặc mở Nhật ký từ một tín hiệu.'}</p></div>:timeline.slice((current-1)*pageSize,current*pageSize).map((entry,index,items)=>{const cycle=cycleFor(entry);return <Fragment key={entry.id}>{(index===0||items[index-1].decision_date!==entry.decision_date)&&<h3 className="journal-day">{formatDate(entry.decision_date)}</h3>}<div className="journal-event"><button className="journal-event-main" onClick={()=>setSelected({entry:entry.id})}><span className="journal-event-heading"><strong>{entry.symbols?.symbol??'—'}</strong><span className={`action-pill ${entry.decision==='BUY'?'probe_buy':['SELL','STOP'].includes(entry.decision)?'exit':'watch'}`}>{entry.decision}</span><span>{strategyName(entry)}</span><small>{journalRoles[entry.workflow?.role??'UNKNOWN']}</small></span><span className="journal-event-meta">{journalSources[entry.workflow?.source??(entry.transaction_id?'PORTFOLIO':'UNKNOWN')]} · {journalStatuses[entryStatus(entry)]}{entry.workflow?.subtype?` · ${entry.workflow.subtype}`:''}</span><span className="journal-event-reason">{entry.rationale}</span></button><div className="journal-event-actions">{cycle&&<button type="button" className="text-button" onClick={()=>setSelected({cycle:cycle.id})}>Xem vòng</button>}<details className="journal-menu"><summary aria-label={`Thao tác ${entry.symbols?.symbol}`}><MoreHorizontal size={18}/></summary><div><button className="text-button" onClick={()=>edit(entry)}>Cập nhật</button>{!entry.transaction_id&&<button className="text-button" onClick={()=>void remove(entry)}>Xóa</button>}</div></details></div></div></Fragment>})}{pagination}</article>}
    </div>
    {userId&&form&&<JournalForm key={`${userId}:${form.editing?.id??form.launch?.symbol??'new'}:${form.cycle??''}`} userId={userId} editing={form.editing} launch={form.launch} initialCycleId={form.cycle} transactions={transactions} entries={entries} cycles={cycles} onClose={closeForm} onSave={save} notify={notify}/>}
    {!form&&(selectedEntry||selectedCycle)&&<JournalDetail entry={selectedEntry} cycle={selectedCycle} onClose={closeDetail} onEdit={edit} onNew={(symbol,cycle)=>{setSelected(null);setForm({editing:null,launch:{symbol},cycle})}}/>}
    <FeedbackToast feedback={feedback}/>
  </section>
}
