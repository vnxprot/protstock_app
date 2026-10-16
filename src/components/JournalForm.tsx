import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { todayInVietnam, formatDate } from '../lib/date'
import { latestSignalPublication } from '../lib/signalPublication'
import { journalContext, type JournalEvidenceSnapshot } from '../lib/journalEvidence'
import { adherenceLabels, journalActions, journalConflict, journalRoles, journalSources, journalStatuses, journalStrategies, newWorkflow, type JournalAction, type JournalCycle, type JournalEntry, type JournalLaunch, type JournalTransaction, type JournalWorkflow } from '../lib/journalModel'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { useSymbols } from '../hooks/useStockAnalysis'
import { useStockThesis } from '../hooks/useStockThesis'
import { SymbolAutocomplete } from './SymbolAutocomplete'
import { SoftSelect } from './SoftSelect'
import { formatVnd } from '../lib/marketUnits'

type Props = { userId:string; editing:JournalEntry|null; launch:JournalLaunch|null; initialCycleId?:string; transactions:JournalTransaction[]; entries:JournalEntry[]; cycles:JournalCycle[]; onClose:()=>void; onSave:(entry:JournalEntry)=>Promise<void>; notify:(message:string)=>void }
type Draft = { id:string;symbol:string;decision:JournalAction;rationale:string;market:string;lesson:string;workflow:JournalWorkflow;execution:string;cycle:string }
export function JournalForm({userId,editing,launch,initialCycleId,transactions,entries,cycles,onClose,onSave,notify}:Props) {
  const draftKey = `protstock-journal-${editing?'edit-':''}draft:${userId}:${editing?.id ?? initialCycleId ?? launch?.symbol ?? '_new'}`
  const [draft,setDraft] = useState<Draft>(()=>{
    try { const saved = JSON.parse(localStorage.getItem(draftKey)??'null'); if(saved?.workflow?.schema===1) return saved } catch { /* A corrupt draft cannot replace saved evidence. */ }
    const workflow = structuredClone(editing?.workflow ?? newWorkflow())
    if(editing&&!editing.workflow){workflow.source=editing.transaction_id?'PORTFOLIO':'UNKNOWN';workflow.role='UNKNOWN';workflow.emotion=editing.lesson?.match(/\[emotion:(\w+)\]/)?.[1]??'DISCIPLINED'}
    if(!editing&&launch) {
      if(launch.source && launch.source in journalSources) workflow.source=launch.source as JournalWorkflow['source']
      workflow.strategy=launch.strategy??''; workflow.version=launch.version??''
      if(launch.role && launch.role in journalRoles) workflow.role=launch.role as JournalWorkflow['role']
    }
    return {id:editing?.id??crypto.randomUUID(),symbol:editing?.symbols?.symbol??launch?.symbol??'',decision:editing?.decision??'WAIT',rationale:editing?.rationale??'',market:editing?.market_state??'',lesson:editing?.lesson?.replace(/\[emotion:\w+\]/g,'').trim()??'',workflow,execution:editing?.linked_transaction_id??'',cycle:editing?.linked_cycle_id??initialCycleId??''}
  })
  const [submitting,setSubmitting]=useState(false), lock=useRef(false), ref=useRef<HTMLFormElement>(null)
  const close=useCallback(()=>{if(!lock.current)onClose()},[onClose])
  useDialogFocus(true,ref,close)
  const set=<K extends keyof Draft>(key:K,value:Draft[K])=>setDraft(previous=>({...previous,[key]:value}))
  const wf=<K extends keyof JournalWorkflow>(key:K,value:JournalWorkflow[K])=>setDraft(previous=>({...previous,workflow:{...previous.workflow,[key]:value}}))
  const symbols=useSymbols(true), selected=symbols.data?.find(item=>item.symbol===draft.symbol)
  const thesis=useStockThesis(draft.symbol,!editing)
  const publication=useQuery({queryKey:['journal-publication'],queryFn:latestSignalPublication,staleTime:60_000})
  const evidenceDate=launch?.date??publication.data?.date
  const snapshot=useQuery({queryKey:['journal-context',userId,selected?.id,evidenceDate,publication.data?.sourceRevision],enabled:Boolean(!editing&&selected&&evidenceDate&&supabase),queryFn:async()=>{
    const {data,error}=await supabase!.rpc('journal_capture_context',{p_symbol_id:selected!.id,p_date:evidenceDate,p_revision:publication.data?.date===evidenceDate?publication.data?.sourceRevision:null})
    if(error)throw error
    return data as JournalEvidenceSnapshot
  }})
  const historical=Boolean(editing?.workflow), automatic=Boolean(editing?.transaction_id), conflict=journalConflict(editing?.evidence_snapshot??snapshot.data)
  const available=transactions.filter(tx=>Number(tx.symbol_id)===(editing?.symbol_id??selected?.id)
    && !entries.some(entry=>entry.id!==editing?.id&&entry.linked_transaction_id===tx.id)
    && (draft.decision==='BUY'?['BUY_NEW','BUY_ADD'].includes(tx.action):['SELL','STOP'].includes(draft.decision)?['SELL_REDUCE','SELL_CLOSE'].includes(tx.action):draft.decision==='HOLD'?tx.action==='STOP_UPDATE':false)
    && tx.trading_date>=(editing?.decision_date??todayInVietnam()))
  const matchingCycles=cycles.filter(cycle=>cycle.symbolId===(editing?.symbol_id??selected?.id))
  useEffect(()=>{try{localStorage.setItem(draftKey,JSON.stringify(draft))}catch{notify('Không lưu được bản nháp trên thiết bị.')}},[draft,draftKey,notify])
  const engines=snapshot.data?.engines??[]
  const chooseStrategy=(strategy:string)=>{
    const matching=engines.filter(item=>item.name===strategy),versions=[...new Set(matching.map(item=>String(item.version)))]
    setDraft(previous=>({...previous,workflow:{...previous.workflow,strategy,version:versions.length===1?versions[0]:'',role:matching.length?'CHAMPION':previous.workflow.role}}))
  }
  async function submit(event:FormEvent) {
    event.preventDefault()
    if(lock.current)return
    if((!selected&&!editing)||!draft.rationale.trim()) {notify('Chọn mã và ghi lý do quyết định.');return}
    if(!draft.workflow.strategy && !editing){notify('Chọn chiến lược chính, hoặc Cá nhân.');return}
    if(['BUY','SELL','STOP'].includes(draft.decision)&&draft.workflow.status==='EXECUTED'&&!draft.execution&&!automatic){notify('Liên kết giao dịch thực trong Danh mục trước khi đánh dấu đã thực hiện.');return}
    if(draft.workflow.plan.expires&&draft.workflow.plan.expires<todayInVietnam()&&!editing){notify('Hạn kế hoạch phải từ hôm nay trở đi.');return}
    lock.current=true;setSubmitting(true)
    try {
      const missing:JournalEvidenceSnapshot={as_of_date:evidenceDate??null,source_revision:null,captured_at:new Date().toISOString(),signals:[]}
      const context=journalContext(editing,snapshot.data??missing,thesis.data?.current_version_id??null)
      const payload:JournalEntry={id:editing?.id??draft.id,user_id:userId,symbol_id:editing?.symbol_id??selected!.id,decision_date:editing?.decision_date??todayInVietnam(),decision:draft.decision,
        rationale:draft.rationale.trim(),setup_type:editing?.setup_type??null,market_state:draft.market||null,lesson:draft.lesson||null,outcome:editing?.outcome??'OPEN',result_pct:editing?.result_pct??null,review_status:editing?.review_status??'OBSERVATION',
        ...context,workflow:draft.workflow,linked_transaction_id:draft.execution||null,linked_cycle_id:draft.cycle||null}
      await onSave(payload);localStorage.removeItem(draftKey);onClose()
    } catch(error) {notify(error instanceof Error?error.message:'Chưa lưu được quyết định. Bản nháp vẫn được giữ.')} finally {lock.current=false;setSubmitting(false)}
  }
  return <div className="sheet-backdrop" onMouseDown={close}><form ref={ref} role="dialog" aria-modal="true" aria-labelledby="journal-form-title" className="bottom-sheet position-sheet rule-form journal-sheet" onSubmit={submit} onMouseDown={event=>event.stopPropagation()}>
    <div className="sheet-handle"/><div className="sheet-title"><h2 id="journal-form-title">{editing?'Cập nhật nhật ký':'Ghi quyết định'}</h2><button type="button" className="icon-button" aria-label="Đóng, giữ bản nháp" disabled={submitting} onClick={close}><X size={20}/></button></div>
    <SymbolAutocomplete symbols={symbols.data??[]} value={draft.symbol} onChange={value=>setDraft(previous=>({...previous,symbol:value,execution:'',cycle:''}))} disabled={Boolean(editing)}/>
    <fieldset className="journal-review-picker"><legend>Quyết định của tôi</legend>{Object.entries(journalActions).filter(([key])=>key!=='STOP'||draft.decision==='STOP').map(([key,label])=><button key={key} type="button" disabled={historical||automatic} aria-pressed={draft.decision===key} className={draft.decision===key?'active':''} onClick={()=>setDraft(previous=>({...previous,decision:key as JournalAction,execution:'',workflow:{...previous.workflow,status:'PLANNED',subtype:''}}))}>{key}</button>)}</fieldset>
    {['BUY','SELL'].includes(draft.decision)&&<label>Loại hành động<SoftSelect disabled={historical||automatic} value={draft.workflow.subtype} onChange={event=>wf('subtype',event.target.value)}><option value="">Chưa phân loại</option>{(draft.decision==='BUY'?['Mua mới','Mua thăm dò','Mua thêm']:['Giảm tỷ trọng','Thoát hết','Cắt lỗ']).map(value=><option key={value}>{value}</option>)}</SoftSelect></label>}
    <div className="journal-form-grid"><label>Chiến lược chính<SoftSelect value={draft.workflow.strategy} disabled={historical} onChange={event=>chooseStrategy(event.target.value)}><option value="">{editing?'Chưa xác định':'Chọn chiến lược'}</option>{[...new Set([...journalStrategies,...engines.map(item=>item.name),...(draft.workflow.strategy?[draft.workflow.strategy]:[])])].map(value=><option key={value}>{value}</option>)}</SoftSelect></label><label>Phiên bản quy tắc<input disabled={historical} value={draft.workflow.version} onChange={event=>wf('version',event.target.value)} placeholder="Chưa xác định" maxLength={120}/></label>
    <label>Nguồn phát hiện<SoftSelect disabled={historical} value={draft.workflow.source} onChange={event=>wf('source',event.target.value as JournalWorkflow['source'])}>{Object.entries(journalSources).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SoftSelect></label>
    <label>Vai trò tại thời điểm ghi<SoftSelect disabled={historical} value={draft.workflow.role} onChange={event=>wf('role',event.target.value as JournalWorkflow['role'])}>{Object.entries(journalRoles).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SoftSelect></label></div>
    {conflict&&<p className="form-error" role="status">{conflict}</p>}
    <label>Lý do quyết định<textarea required rows={2} value={draft.rationale} onChange={event=>set('rationale',event.target.value)} placeholder="Tín hiệu nào khiến tôi hành động hoặc tiếp tục chờ?"/></label>
    <div className="journal-snapshot-note"><strong>{editing?'Giữ bằng chứng và luận điểm lịch sử':snapshot.isLoading?'Đang lấy bằng chứng…':snapshot.isError?'Chưa tải được bằng chứng':snapshot.data?`Bằng chứng phiên ${formatDate(evidenceDate)}`:'Chưa có bằng chứng hệ thống'}</strong><small>{editing?'Đổi chiến lược hoặc kế hoạch bằng một quyết định mới.':snapshot.data?`${snapshot.data.signals.length} tín hiệu tổng hợp · ${engines.length} kết quả engine · kèm Phễu, MACD, Radar, Challenger có sẵn. Dữ liệu EOD có thể cũ hơn hôm nay.`:'Bản ghi sẽ nêu rõ thiếu dữ liệu, không tự tạo bằng chứng.'}</small>{snapshot.isError&&<button type="button" className="text-button" onClick={()=>void snapshot.refetch()}>Thử tải lại</button>}</div>
    <details open={Boolean(draft.execution||automatic)}><summary>Thực hiện và vòng giao dịch</summary><div className="journal-form-grid">
      <label>Trạng thái<SoftSelect disabled={automatic||Boolean(draft.execution)} value={automatic||draft.execution?'EXECUTED':draft.workflow.status} onChange={event=>wf('status',event.target.value as JournalWorkflow['status'])}>{Object.entries(journalStatuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SoftSelect></label>
      {!automatic&&<label>Giao dịch thực<SoftSelect value={draft.execution} onChange={event=>setDraft(previous=>({...previous,execution:event.target.value,workflow:{...previous.workflow,status:event.target.value?'EXECUTED':'PLANNED'}}))}><option value="">Chưa liên kết</option>{available.map(tx=><option key={tx.id} value={tx.id}>{formatDate(tx.trading_date)} · {tx.action} · {tx.quantity} CP · {formatVnd(tx.price)}</option>)}</SoftSelect></label>}
      <label>Gắn vào vòng giao dịch<SoftSelect value={draft.cycle} onChange={event=>set('cycle',event.target.value)}><option value="">{draft.execution||automatic?'Tự nhận từ giao dịch thực':'Chưa gắn vòng'}</option>{matchingCycles.map(cycle=><option key={cycle.id} value={cycle.id}>{cycle.symbol} · {formatDate(cycle.openedAt)} · {cycle.closedAt?'Đã đóng':'Đang mở'}</option>)}</SoftSelect></label>
    </div><p className="muted">BUY/SELL chưa khớp chỉ là kế hoạch. <a href="#portfolio">Mở Danh mục</a> để ghi giao dịch thực, sau đó quay lại liên kết. Ghi từ sổ có sẵn giữ liên kết gốc.</p></details>
    <details><summary>Kế hoạch entry / exit và đánh giá sau phiên</summary><div className="journal-form-grid">{(['entry','stop','target'] as const).map((key,index)=><label key={key}>{['Giá vào dự kiến','Stop ban đầu','Mục tiêu'][index]} · VND<input type="number" min="1" step="any" disabled={historical} value={draft.workflow.plan[key]??''} onChange={event=>wf('plan',{...draft.workflow.plan,[key]:event.target.value?Number(event.target.value):null})}/></label>)}<label>Hiệu lực đến<input type="date" disabled={historical} value={draft.workflow.plan.expires??''} onChange={event=>wf('plan',{...draft.workflow.plan,expires:event.target.value})}/></label></div>
      <label>Điều kiện kích hoạt / vô hiệu<input disabled={historical} value={draft.workflow.plan.trigger??''} onChange={event=>wf('plan',{...draft.workflow.plan,trigger:event.target.value})}/></label>
      <label><input type="checkbox" disabled={Boolean(editing)} checked={Boolean(draft.workflow.evaluation)} onChange={event=>wf('evaluation',event.target.checked?{horizon:10,direction:'UP',threshold:0}:null)}/> Đăng ký đánh giá diễn biến giá từ lúc lưu</label>
      {draft.workflow.evaluation&&<div className="journal-form-grid"><label>Thời hạn<SoftSelect disabled={Boolean(editing)} value={draft.workflow.evaluation.horizon} onChange={event=>wf('evaluation',{...draft.workflow.evaluation!,horizon:Number(event.target.value) as 5|10|20})}>{[5,10,20].map(value=><option key={value} value={value}>{value} phiên</option>)}</SoftSelect></label><label>Hướng kỳ vọng<SoftSelect disabled={Boolean(editing)} value={draft.workflow.evaluation.direction} onChange={event=>wf('evaluation',{...draft.workflow.evaluation!,direction:event.target.value as 'UP'|'DOWN'})}><option value="UP">Tăng</option><option value="DOWN">Giảm</option></SoftSelect></label><label>Biến động tối thiểu · %<input type="number" min="0" max="100" step="0.1" disabled={Boolean(editing)} value={draft.workflow.evaluation.threshold} onChange={event=>wf('evaluation',{...draft.workflow.evaluation!,threshold:Number(event.target.value)})}/></label></div>}
      <p className="muted">Tiêu chí khóa lúc lưu. Đo Close cuối kỳ so với Close hợp lệ gần nhất lúc lưu; đếm phiên VN-Index sau ngày ghi. Đây là quan sát giá, chưa gồm phí và không giả định khớp lệnh.</p>
    </details>
    <details><summary>Bằng chứng hỗ trợ, kỷ luật và bài học</summary>
      <div className="journal-review-picker">{['MACD','Volume','Xu hướng tuần/tháng','Sức mạnh tương đối','Phễu','Radar','Cảnh báo xung đột'].map(label=><label key={label}><input type="checkbox" disabled={historical} checked={draft.workflow.support.includes(label)} onChange={event=>wf('support',event.target.checked?[...draft.workflow.support,label]:draft.workflow.support.filter(item=>item!==label))}/>{label}</label>)}</div>
      {['Đã kiểm tra điều kiện chiến lược','Đã kiểm tra stop và quy mô','Đã kiểm tra cảnh báo xung đột'].map(label=><label key={label}><input type="checkbox" disabled={historical} checked={draft.workflow.checks.some(check=>check.label===label&&check.passed)} onChange={event=>wf('checks',[...draft.workflow.checks.filter(check=>check.label!==label),{label,passed:event.target.checked}])}/>{label}</label>)}
      <div className="journal-form-grid"><label>Mức tuân thủ<SoftSelect value={draft.workflow.adherence} onChange={event=>wf('adherence',event.target.value as JournalWorkflow['adherence'])}>{Object.entries(adherenceLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SoftSelect></label><label>Bối cảnh thị trường<input disabled={historical} value={draft.market} onChange={event=>set('market',event.target.value)} placeholder="Tăng / đi ngang / giảm…"/></label><label>Tâm lý<SoftSelect value={draft.workflow.emotion} onChange={event=>wf('emotion',event.target.value)}>{[['DISCIPLINED','Kỷ luật'],['FOMO','FOMO'],['FEAR','Sợ hãi'],['RUSHED','Vội vàng']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</SoftSelect></label></div>
      <label>Bài học / tổng kết<textarea rows={2} value={draft.lesson} onChange={event=>set('lesson',event.target.value)}/></label>
    </details>
    <div className="form-sticky-actions"><button type="submit" className="primary-button" disabled={submitting||snapshot.isLoading}>{submitting?'Đang lưu…':'Lưu quyết định'}</button><a href="#settings?guide=journal">Hướng dẫn Nhật ký</a></div>
  </form></div>
}
