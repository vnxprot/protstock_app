import { type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, CheckCircle2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAccountId } from '../hooks/useAccountId'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { useSymbols } from '../hooks/useStockAnalysis'
import { useStockThesis } from '../hooks/useStockThesis'
import { latestSignalPublication } from '../lib/signalPublication'
import { formatDate, todayInVietnam } from '../lib/date'
import { realizedSlices, type LedgerReport } from '../lib/portfolioLedger'
import { journalContext, withEmotionTag } from '../lib/journalEvidence'
import { readJournalOutbox, queueJournalNote, syncJournalOutbox, clearSavedJournalDrafts } from '../lib/journalOutbox'
import { formatVnd } from '../lib/marketUnits'
import { displaySystemRevision } from '../lib/releaseLabels'
import { SymbolAutocomplete } from './SymbolAutocomplete'
import { SoftSelect } from './SoftSelect'
import '../personal-workspace.css'

const reviews = { OBSERVATION: 'Quan sát', MAINTAIN: 'Giữ luận điểm', REVIEW: 'Cần xem lại', INVALIDATED: 'Luận điểm vô hiệu' } as const
type Review = keyof typeof reviews
type Evidence = { as_of_date: string | null; source_revision: string | null; captured_at: string; signals: Array<{timeframe:string;action:string;state:string;score:number;reasons:string[]}> }
type JournalEntry = { id:string;user_id?:string;symbol_id:number;decision_date:string;decision:string;setup_type:string|null;market_state:string|null;rationale:string;outcome:string;result_pct:number|null;lesson:string|null;review_status:Review|null;thesis_version_id:string|null;evidence_snapshot:Evidence|null;symbols?:{symbol:string;sector?:string|null}|null }
type QueuedNote = Omit<JournalEntry,'symbols'>
const readQueue = (owner:string) => readJournalOutbox<QueuedNote>(owner)
const symbolFromRoute = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('symbol')?.toUpperCase() ?? ''
const emotionLabels:Record<string,string> = {DISCIPLINED:'Kỷ luật',FOMO:'FOMO',FEAR:'Sợ hãi',RUSHED:'Vội vàng'}
const draftKey = (owner:string, code:string) => 'protstock-journal-draft:'+owner+':'+(code||'_new')

function HistoricalThesis({versionId,userId}:{versionId:string;userId:string|null}) {
  const [open,setOpen]=useState(false)
  const version=useQuery({queryKey:['journal-thesis-version',userId,versionId],enabled:Boolean(open&&userId&&supabase),staleTime:Infinity,queryFn:async()=>{
    const {data,error}=await supabase!.from('investment_thesis_versions').select('version,thesis,catalysts,invalidation_conditions,risk_notes').eq('id',versionId).single()
    if(error)throw error
    return data
  }})
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Luận điểm cá nhân đã gắn vào nhận xét</summary>{open&&(version.isLoading?<p role="status">Đang tải phiên bản lịch sử…</p>:version.isError?<p role="alert">Chưa tải được phiên bản. <button type="button" onClick={()=>void version.refetch()}>Thử lại</button></p>:version.data&&<><p><strong>v{version.data.version} · Vì sao đầu tư?</strong></p><p>{version.data.thesis}</p>{version.data.invalidation_conditions&&<p>Điều kiện vô hiệu: {version.data.invalidation_conditions}</p>}{version.data.risk_notes&&<p>Rủi ro: {version.data.risk_notes}</p>}</>)}</details>
}

export function JournalPage({ authenticated }: { authenticated: boolean }) {
  const client = useQueryClient(), userId = useAccountId(authenticated), symbols = useSymbols(authenticated)
  const [symbol,setSymbol] = useState(''), [rationale,setRationale] = useState(''), [review,setReview] = useState<Review>('OBSERVATION')
  const [setup,setSetup] = useState(''), [marketState,setMarketState] = useState(''), [emotion,setEmotion] = useState('DISCIPLINED')
  const [editing,setEditing] = useState<JournalEntry|null>(null), [formOpen,setFormOpen] = useState(false), [submitting,setSubmitting] = useState(false)
  const [toast,setToast] = useState(''), [page,setPage] = useState(1), [filter,setFilter] = useState('')
  const [queued,setQueued] = useState<QueuedNote[]>([]), [syncing,setSyncing] = useState(false)
  const formRef = useRef<HTMLFormElement>(null), lock = useRef(false), noteId = useRef(crypto.randomUUID()), syncLock = useRef(false)
  const closeForm = useCallback(() => { if (!lock.current) setFormOpen(false) },[])
  useDialogFocus(formOpen,formRef,closeForm)
  const thesis = useStockThesis(symbol,authenticated&&!editing)
  const publication = useQuery({queryKey:['journal-publication'],enabled:Boolean(userId&&supabase),staleTime:60_000,queryFn:latestSignalPublication})
  const selectedSymbol = symbols.data?.find(item=>item.symbol===symbol)
  const evidence = useQuery({queryKey:['journal-evidence',publication.data?.date,publication.data?.sourceRevision,selectedSymbol?.id],enabled:Boolean(userId&&supabase&&selectedSymbol&&publication.data&&!editing),staleTime:60_000,queryFn:async()=>{
    const {data,error}=await supabase!.from('consolidated_signals').select('timeframe,composite_action,signal_state,confluence_score,reasons').eq('symbol_id',selectedSymbol!.id).eq('as_of_date',publication.data!.date).eq('source_revision',publication.data!.sourceRevision).order('timeframe')
    if(error)throw error
    return(data??[]).map(item=>({timeframe:item.timeframe,action:item.composite_action,state:item.signal_state,score:Number(item.confluence_score),reasons:item.reasons??[]}))
  }})
  const entries = useQuery({queryKey:['journal',userId,page,filter],enabled:Boolean(userId&&supabase),queryFn:async()=>{
    let query=supabase!.from('journal_entries').select('id,user_id,symbol_id,decision_date,decision,setup_type,market_state,rationale,outcome,result_pct,lesson,review_status,thesis_version_id,evidence_snapshot,symbols!inner(symbol,sector)',{count:'exact'}).eq('user_id',userId!).order('decision_date',{ascending:false}).order('created_at',{ascending:false})
    if(filter.trim())query=query.ilike('symbols.symbol','%'+filter.trim().toUpperCase()+'%')
    const {data,error,count}=await query.range((page-1)*25,page*25-1)
    if(error)throw error
    return {rows:(data??[]).map((item:any)=>({...item,symbols:Array.isArray(item.symbols)?item.symbols[0]:item.symbols})) as JournalEntry[],count:count??0}
  }})
  const ledger = useQuery({queryKey:['journal-portfolio-transactions',userId],enabled:Boolean(userId&&supabase),queryFn:async()=>{
    const {data:portfolio,error:portfolioError}=await supabase!.from('portfolios').select('id').eq('user_id',userId!).order('created_at').limit(1).maybeSingle()
    if(portfolioError)throw portfolioError
    if(!portfolio)return null
    const {data,error}=await supabase!.rpc('portfolio_report_data',{p_portfolio_id:portfolio.id,p_as_of_date:todayInVietnam()})
    if(error)throw error
    return data as LedgerReport
  }})
  const realized = useMemo(()=>Object.entries(realizedSlices(ledger.data?.transactions??[])),[ledger.data])
  const realizedPnl = realized.reduce((sum,[,slice])=>sum+slice.pnl,0)
  const wins = realized.filter(([,slice])=>slice.pnl>0).length
  const winRate = realized.length ? wins / realized.length * 100 : 0
  const rows=entries.data?.rows??[], pageCount=Math.max(1,Math.ceil((entries.data?.count??0)/25))
  useEffect(()=>setPage(1),[filter])
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(timer)},[toast])

  const openNew = useCallback((code='')=>{
    let draft:any=null
    if(userId)try{const remembered=code||localStorage.getItem('protstock-journal-lastdraft:'+userId)||'';draft=JSON.parse(localStorage.getItem(draftKey(userId,remembered))??'null')}catch{draft=null}
    setEditing(null);setSymbol(code||draft?.symbol||'');setRationale(draft?.rationale??'');setReview(draft?.review??'OBSERVATION');setSetup(draft?.setup??'');setMarketState(draft?.marketState??'');setEmotion(draft?.emotion??'DISCIPLINED');noteId.current=draft?.id??crypto.randomUUID();setFormOpen(true)
  },[userId])
  useEffect(()=>{
    if(!userId)return
    const code=symbolFromRoute()
    if(code)openNew(code)
    const onOpen=(event:Event)=>openNew((event as CustomEvent<{symbol:string}>).detail?.symbol??'')
    const onHash=()=>{const routeCode=symbolFromRoute();if(routeCode)openNew(routeCode)}
    addEventListener('protstock:journal',onOpen);addEventListener('hashchange',onHash)
    return()=>{removeEventListener('protstock:journal',onOpen);removeEventListener('hashchange',onHash)}
  },[userId,openNew])
  useEffect(()=>{
    if(!userId||!formOpen)return
    const key=editing?'protstock-journal-edit-draft:'+userId+':'+editing.id:draftKey(userId,symbol)
    try{localStorage.setItem(key,JSON.stringify({id:noteId.current,symbol,rationale,review,setup,marketState,emotion}));if(!editing)localStorage.setItem('protstock-journal-lastdraft:'+userId,symbol)}catch{setToast('Thiết bị không lưu được bản nháp. Hãy lưu ghi chú trước khi đóng.')}
  },[userId,formOpen,editing,symbol,rationale,review,setup,marketState,emotion])

  const retryQueue=useCallback(async()=>{
    if(!userId||!supabase||syncLock.current)return
    syncLock.current=true;setSyncing(true)
    try{
      await syncJournalOutbox<QueuedNote>(userId,item=>supabase!.from('journal_entries').insert(item))
      setQueued(readQueue(userId));await client.invalidateQueries({queryKey:['journal']})
    }catch{setQueued(readQueue(userId))}
    finally{syncLock.current=false;setSyncing(false)}
  },[userId,client])
  useEffect(()=>{
    if(!userId)return
    setQueued(readQueue(userId));void retryQueue()
    const onOnline=()=>void retryQueue();const onStorage=(event:StorageEvent)=>{if(event.key?.startsWith('protstock-journal-outbox:'+userId)){setQueued(readQueue(userId));void retryQueue()}}
    addEventListener('online',onOnline);addEventListener('storage',onStorage)
    return()=>{removeEventListener('online',onOnline);removeEventListener('storage',onStorage)}
  },[userId,retryQueue])

  const openEdit=(item:JournalEntry)=>{
    let draft:any=null
    if(userId)try{draft=JSON.parse(localStorage.getItem('protstock-journal-edit-draft:'+userId+':'+item.id)??'null')}catch{draft=null}
    setEditing(item);setSymbol(item.symbols?.symbol??'');setRationale(draft?.rationale??item.rationale);setReview(draft?.review??item.review_status??'OBSERVATION');setSetup(draft?.setup??item.setup_type??'');setMarketState(draft?.marketState??item.market_state??'');setEmotion(draft?.emotion??item.lesson?.match(/\[emotion:(\w+)\]/)?.[1]??'DISCIPLINED');setFormOpen(true)
  }
  async function save(event:FormEvent){
    event.preventDefault()
    if(!supabase||!userId||lock.current)return
    if((!selectedSymbol&&!editing)||!rationale.trim()){setToast('Chọn mã và ghi ít nhất một câu nhận xét.');return}
    lock.current=true;setSubmitting(true)
    const snapshot:Evidence={as_of_date:publication.data?.date??null,source_revision:publication.data?.sourceRevision??null,captured_at:new Date().toISOString(),signals:evidence.data??[]}
    const context=journalContext(editing,snapshot,thesis.data?.current_version_id??null)
    const payload:QueuedNote={id:editing?.id??noteId.current,user_id:userId,symbol_id:editing?.symbol_id??selectedSymbol!.id,decision_date:editing?.decision_date??todayInVietnam(),decision:review==='MAINTAIN'?'HOLD':'SKIP',setup_type:setup||null,market_state:marketState||null,rationale:rationale.trim(),outcome:editing?.outcome??'OPEN',result_pct:editing?.result_pct??null,lesson:withEmotionTag(editing?.lesson,emotion),review_status:review,...context}
    try{
      const {error}=editing?await supabase.from('journal_entries').update(payload).eq('id',editing.id).eq('user_id',userId):await supabase.from('journal_entries').insert(payload)
      if(error&&(editing||error.code!=='23505')){
        if(editing||error.code?.startsWith('23')||error.code==='42501')throw error
        queueJournalNote(userId,payload);setQueued(readQueue(userId));setToast('Đã lưu trên thiết bị, đang chờ đồng bộ. Có thể thử lại khi có mạng.')
      }else{setToast('Đã lưu nhật ký cùng luận điểm và bằng chứng tại thời điểm ghi.');await client.invalidateQueries({queryKey:['journal']})}
      if(editing)localStorage.removeItem('protstock-journal-edit-draft:'+userId+':'+editing.id)
      if(!editing){clearSavedJournalDrafts(userId,payload.id);localStorage.removeItem('protstock-journal-lastdraft:'+userId)}
      setFormOpen(false);if(symbolFromRoute())history.replaceState(null,'','#journal')
    }catch{setToast('Chưa lưu được ghi chú. Nội dung vẫn được giữ để bạn thử lại.')}
    finally{lock.current=false;setSubmitting(false)}
  }
  async function remove(item:JournalEntry){
    if(!supabase||!userId||lock.current||!confirm('Xóa nhận xét '+(item.symbols?.symbol??'')+'?'))return
    lock.current=true
    try{const {error}=await supabase.from('journal_entries').delete().eq('id',item.id).eq('user_id',userId);if(error)throw error;await client.invalidateQueries({queryKey:['journal']});setToast('Đã xóa nhận xét.')}catch{setToast('Không xóa được nhận xét. Kiểm tra kết nối và thử lại.')}finally{lock.current=false}
  }
  return <section className="workspace-page journal-page journal-v3-page">
    <div className="page-title-row"><div><h1>Nhật ký quyết định</h1><p className="muted">Đo chất lượng quyết định, không chỉ kết quả giao dịch.</p></div><button type="button" className="primary-button" disabled={!userId} onClick={()=>openNew()}><Plus size={16}/> Ghi nhận xét</button></div>
    {queued.length>0&&<article className="panel" role="status"><h2>{queued.length} ghi chú đang chờ đồng bộ</h2><p>Nội dung đã lưu theo tài khoản trên thiết bị này.</p><button type="button" className="secondary-button" disabled={syncing} onClick={()=>void retryQueue()}>{syncing?'Đang đồng bộ…':'Thử đồng bộ'}</button>{queued.map(item=><p key={item.id}><strong>{symbols.data?.find(stock=>stock.id===item.symbol_id)?.symbol??'Mã'} · {reviews[item.review_status??'OBSERVATION']}</strong> — {item.rationale}</p>)}</article>}
    <section className="metric-grid metric-grid-compact journal-v3-metrics"><article className="metric-card"><span>Nhận xét đã lưu</span><strong>{entries.isLoading?'—':entries.data?.count??'—'}</strong></article><article className="metric-card"><span>Giao dịch bán có kết quả</span><strong>{ledger.isSuccess?realized.length:'—'}</strong></article><article className="metric-card"><span>Lãi/lỗ đã thực hiện</span><strong className={realizedPnl<0?'negative':'positive'}>{ledger.isSuccess?formatVnd(realizedPnl):'—'}</strong></article></section>
    <div className="analytics-grid journal-analytics journal-v3-analytics"><article className="analytic-card equity-card"><div className="panel-title"><h3>Hiệu suất đã thực hiện</h3><span>{realized.length} lệnh bán</span></div><strong className={realizedPnl<0?'negative':'positive'}>{ledger.isSuccess?formatVnd(realizedPnl):'—'}</strong><p className="muted">Tổng lãi/lỗ từ các giao dịch bán đã ghi trong danh mục.</p></article><article className="analytic-card"><h3>Tỷ lệ bán có lãi</h3><div className="win-gauge" style={{'--win':`${winRate*3.6}deg`} as CSSProperties}><div><strong>{realized.length?winRate.toFixed(0):'—'}%</strong><span>{wins} có lãi / {realized.length} lệnh</span></div></div></article></div>
    <p className="muted personal-desktop-panel">Thống kê chỉ dùng giao dịch bán thực từ sổ danh mục, giá vốn bình quân gia quyền; chưa gồm phí/thuế. Nhận xét không được tính thành lệnh thắng/thua. Bằng chứng cũ được giữ nguyên để tránh đánh giá bằng dữ liệu hôm nay.</p>
    {ledger.isError&&<p className="form-error personal-desktop-panel">Chưa tải được kết quả sổ giao dịch. <button type="button" onClick={()=>void ledger.refetch()}>Thử lại</button></p>}
    <article className="panel journal-v3-timeline"><div className="panel-title"><h2>Dòng thời gian quyết định</h2><label className="journal-search"><span>Tìm mã</span><input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="VD: FPT"/></label></div>
      {entries.isLoading?<p role="status">Đang tải nhật ký…</p>:entries.isError?<p className="form-error" role="alert">Không tải được nhật ký. <button type="button" onClick={()=>void entries.refetch()}>Thử lại</button></p>:!rows.length?<div className="empty-state"><BookOpen size={24}/><p>{filter?'Không có nhận xét khớp mã.':'Chưa có nhận xét. Ghi lại lý do theo dõi và điều có thể làm luận điểm thay đổi.'}</p></div>:rows.map(item=><article className="personal-journal-entry journal-v3-entry" key={item.id}><header><div><strong>{item.symbols?.symbol??'—'}</strong><span>{reviews[item.review_status??'OBSERVATION']}</span><time>{formatDate(item.decision_date)}</time></div><div><button type="button" aria-label={'Sửa nhận xét '+item.symbols?.symbol} onClick={()=>openEdit(item)}><Pencil size={16}/> Sửa</button><button type="button" aria-label={'Xóa nhận xét '+item.symbols?.symbol} onClick={()=>void remove(item)}><Trash2 size={16}/> Xóa</button></div></header><p>{item.rationale}</p><small>{item.thesis_version_id?'Đã gắn phiên bản luận điểm cá nhân':'Chưa gắn luận điểm'} · {emotionLabels[item.lesson?.match(/\[emotion:(\w+)\]/)?.[1]??'']??'Chưa gắn tâm lý'}</small><details><summary>Bằng chứng tại thời điểm ghi · {formatDate(item.evidence_snapshot?.as_of_date)}</summary>{item.evidence_snapshot?.signals?.length?<><p>Phiên {formatDate(item.evidence_snapshot.as_of_date)} · {displaySystemRevision(item.evidence_snapshot.source_revision)}</p>{item.evidence_snapshot.signals.map(signal=><p key={signal.timeframe}>{signal.timeframe} · {signal.action} · {signal.score.toFixed(0)} điểm</p>)}</>:<p>Nhận xét này chưa có snapshot engine. Dữ liệu hiện tại không được dùng thay thế dữ liệu lịch sử.</p>}</details>{item.thesis_version_id&&<HistoricalThesis versionId={item.thesis_version_id} userId={userId}/>}</article>)}
      {pageCount>1&&<nav className="screener-pagination" aria-label="Phân trang nhật ký"><span>Trang {page}/{pageCount}</span><div><button disabled={page===1} onClick={()=>setPage(value=>value-1)}>Trước</button><button disabled={page>=pageCount} onClick={()=>setPage(value=>value+1)}>Sau</button></div></nav>}
    </article>
    {formOpen&&<div className="sheet-backdrop" onMouseDown={closeForm}><form ref={formRef} role="dialog" aria-modal="true" aria-labelledby="journal-title" tabIndex={-1} className="bottom-sheet position-sheet rule-form journal-sheet" onSubmit={save} onMouseDown={event=>event.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><h2 id="journal-title">{editing?'Sửa nhận xét':'Ghi nhật ký nhanh'}</h2><button type="button" className="icon-button" disabled={submitting} aria-label="Đóng nhật ký, giữ bản nháp" onClick={closeForm}><X size={20}/></button></div><SymbolAutocomplete symbols={symbols.data??[]} value={symbol} onChange={setSymbol} disabled={Boolean(editing)}/><fieldset className="journal-review-picker"><legend>Trạng thái review</legend>{Object.entries(reviews).map(([code,label])=><button key={code} type="button" aria-pressed={review===code} className={review===code?'active':''} onClick={()=>setReview(code as Review)}>{label}</button>)}</fieldset><label>Điều tôi nghĩ <textarea rows={4} required value={rationale} onChange={event=>setRationale(event.target.value)} placeholder="Vì sao theo dõi, điều mới quan sát hoặc điều khiến luận điểm thay đổi…"/></label><div className="journal-snapshot-note"><strong>{editing?editing.thesis_version_id?'Giữ phiên bản luận điểm đã gắn':'Nhận xét cũ chưa gắn luận điểm':thesis.data?'Gắn với luận điểm v'+thesis.data.current_version.version:'Chưa có luận điểm cá nhân cho mã này'}</strong><small>{editing?editing.evidence_snapshot?'Giữ nguyên bằng chứng đã ghi':'Không có snapshot lịch sử; giữ nguyên trạng thái chưa có bằng chứng.':evidence.data?.length?'Kèm bằng chứng EOD '+formatDate(publication.data?.date):'Chưa có bằng chứng engine; lưu nhận xét cá nhân và ghi rõ thiếu dữ liệu.'}</small></div><details><summary>Phân loại thêm</summary><label>Setup<input value={setup} onChange={event=>setSetup(event.target.value)} placeholder="Ví dụ: nhịp hồi về hỗ trợ"/></label><label>Bối cảnh thị trường<input value={marketState} onChange={event=>setMarketState(event.target.value)}/></label><label>Tâm lý<SoftSelect value={emotion} onChange={event=>setEmotion(event.target.value)} aria-label="Tâm lý khi nhận xét">{Object.entries(emotionLabels).map(([code,label])=><option value={code} key={code}>{label}</option>)}</SoftSelect></label></details><p className="muted">Bản nháp được giữ trên thiết bị theo tài khoản. Ghi chú không tạo giao dịch.</p><div className="form-sticky-actions"><button disabled={submitting}>{submitting?'Đang lưu…':'Lưu nhận xét'}</button></div></form></div>}
    {toast&&<div className="toast" role="status"><CheckCircle2 size={18}/>{toast}</div>}
  </section>
}
