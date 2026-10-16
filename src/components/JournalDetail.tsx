import { useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { formatDate, formatDateTime } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'
import { adherenceLabels, entryStatus, journalActions, journalConflict, journalRoles, journalSources, journalStatuses, linkedTransaction, strategyKey, type JournalCycle, type JournalEntry } from '../lib/journalModel'

function HistoricalThesis({entry}:{entry:JournalEntry}) {
  const query=useQuery({queryKey:['journal-thesis-version',entry.user_id,entry.thesis_version_id],enabled:Boolean(entry.thesis_version_id&&supabase),staleTime:Infinity,queryFn:async()=>{const {data,error}=await supabase!.from('investment_thesis_versions').select('version,thesis,catalysts,invalidation_conditions,risk_notes').eq('id',entry.thesis_version_id!).single();if(error)throw error;return data}})
  return <details><summary>Luận điểm đã gắn</summary>{query.isLoading?<p>Đang tải…</p>:query.isError?<p role="alert">Chưa tải được luận điểm. <button className="text-button" onClick={()=>void query.refetch()}>Thử lại</button></p>:query.data?<><p>v{query.data.version} · {query.data.thesis}</p><p>Vô hiệu: {query.data.invalidation_conditions||'—'}</p><p>Rủi ro: {query.data.risk_notes||'—'}</p></>:<p>Chưa có luận điểm.</p>}</details>
}
function Evidence({entry}:{entry:JournalEntry}) {
  const evidence=entry.evidence_snapshot
  return <details><summary>Bằng chứng phiên {formatDate(evidence?.as_of_date)}</summary>{!evidence?<p>Chưa có bằng chứng lịch sử. Không dùng dữ liệu hiện tại thay thế.</p>:<>
    <p>Ghi nhận {formatDateTime(evidence.captured_at)} · {evidence.source_revision||'Chưa rõ phiên bản công bố'}</p>
    {journalConflict(evidence)&&<p className="form-error">{journalConflict(evidence)}</p>}
    {evidence.signals.map((signal,index)=><p key={index}><strong>{signal.timeframe} · {signal.action}</strong> · {signal.state} · {signal.score} điểm<br/>{signal.reasons.join(' · ')}</p>)}
    {evidence.engines?.map(item=><p key={item.rule_version_id+String(item.signal.timeframe)}><strong>{item.name} · v{item.version}</strong> · {String(item.signal.action??'—')}<br/>{Array.isArray(item.signal.reasons)?item.signal.reasons.join(' · '):''}</p>)}
    {(['challenger','funnel','radar','macd'] as const).map((key,index)=>evidence[key]?.length?<details key={key}><summary>{['Challenger','Phễu','Radar','MACD'][index]} · {evidence[key]!.length} đánh giá</summary>{evidence[key]!.map((item,i)=><div key={i}><p><strong>{item.strategy_code??item.version??item.engine_version??key}</strong> · {item.action??item.stage??item.evidence?.funnel_stage??'—'}</p>{item.reasons&&<p>{item.reasons.join(' · ')}</p>}<details><summary>Bằng chứng chi tiết</summary><pre className="journal-evidence-json">{JSON.stringify(item.evidence??item,null,2)}</pre></details></div>)}</details>:null)}
    {!evidence.signals.length&&!evidence.engines?.length&&<p>Không có tín hiệu tổng hợp hoặc engine trong phiên đã ghi; xem các nguồn nghiên cứu nếu có.</p>}
  </>}</details>
}
export function JournalNote({entry,onEdit}:{entry:JournalEntry;onEdit:(entry:JournalEntry)=>void}) {
  const workflow=entry.workflow
  return <article className="journal-note-detail"><div className="panel-title"><h3>{entry.symbols?.symbol} · {journalActions[entry.decision]??entry.decision}</h3><button className="secondary-button" onClick={()=>onEdit(entry)}>Cập nhật</button></div><p className="muted">{formatDate(entry.decision_date)} · {formatDateTime(entry.created_at)} · {journalStatuses[entryStatus(entry)]}</p><p>{entry.rationale}</p>
    <dl className="journal-facts"><div><dt>Chiến lược chính</dt><dd>{strategyKey(entry)}</dd></div><div><dt>Nguồn phát hiện</dt><dd>{journalSources[workflow?.source??(entry.transaction_id?'PORTFOLIO':'UNKNOWN')]}</dd></div><div><dt>Vai trò</dt><dd>{journalRoles[workflow?.role??'UNKNOWN']}</dd></div><div><dt>Tuân thủ</dt><dd>{adherenceLabels[workflow?.adherence??'UNKNOWN']}</dd></div><div><dt>Bối cảnh</dt><dd>{entry.market_state||'Chưa xác định'}</dd></div><div><dt>Bằng chứng hỗ trợ</dt><dd>{workflow?.support.join(' · ')||'Chưa gắn'}</dd></div></dl>
    {workflow&&<><p>{workflow.subtype} · Tâm lý: {({DISCIPLINED:'Kỷ luật',FOMO:'FOMO',FEAR:'Sợ hãi',RUSHED:'Vội vàng'} as Record<string,string>)[workflow.emotion]??'Chưa xác định'}</p><p>Entry {formatVnd(workflow.plan.entry)} · Stop {formatVnd(workflow.plan.stop)} · Mục tiêu {formatVnd(workflow.plan.target)} · Hạn {formatDate(workflow.plan.expires)}</p>{workflow.plan.trigger&&<p>Điều kiện: {workflow.plan.trigger}</p>}{workflow.checks.map(check=><p key={check.label}>{check.passed?'✓':'○'} {check.label}</p>)}{workflow.evaluation&&<p>Tiêu chí đã khóa: {workflow.evaluation.direction==='UP'?'Tăng':'Giảm'} ≥ {workflow.evaluation.threshold}% sau {workflow.evaluation.horizon} phiên từ lúc lưu.</p>}</>}
    {workflow?.classification_timing==='RETROSPECTIVE'&&<p className="muted">Phân loại hồi cứu lúc {formatDateTime(workflow.classified_at)}; không xác nhận chiến lược đã được chọn trước giao dịch.</p>}
    {workflow?.evaluation&&<p className="muted">Giá gốc quan sát: {formatVnd(workflow.evaluation_base?.close)} · phiên {formatDate(workflow.evaluation_base?.date)}. Đếm các phiên thị trường sau {formatDate(workflow.evaluation_after)}.</p>}
    {entry.lesson&&<p>Bài học: {entry.lesson.replace(/\[emotion:\w+\]/g,'').trim()}</p>}<Evidence entry={entry}/>{entry.thesis_version_id&&<HistoricalThesis entry={entry}/>}
  </article>
}
function ExecutionPath({cycle}:{cycle:JournalCycle}) {
  const trades=cycle.transactions,prices=trades.map(tx=>Number(tx.price)),min=Math.min(...prices),range=Math.max(...prices)-min||1
  const x=(index:number)=>24+index/Math.max(1,trades.length-1)*552,y=(price:number)=>110-(price-min)/range*80
  return <div className="journal-execution-path"><svg viewBox="0 0 600 142" role="img" aria-label="Đường nối giá khớp thực tế theo thứ tự giao dịch"><polyline fill="none" stroke="var(--muted)" strokeWidth="1.5" points={trades.map((tx,index)=>`${x(index)},${y(Number(tx.price))}`).join(' ')}/>{trades.map((tx,index)=><g key={tx.id}><circle cx={x(index)} cy={y(Number(tx.price))} r="4" fill={tx.action.startsWith('BUY')?'var(--mint)':'var(--red, #dd6b75)'}/><title>{formatDate(tx.trading_date)} · {tx.action} · {formatVnd(tx.price)}</title><text x={x(index)} y={index%2?136:14} textAnchor={index===0?'start':index===trades.length-1?'end':'middle'} fill="var(--muted)" fontSize="11">{tx.action.startsWith('BUY')?'Mua':'Bán'} {formatDate(tx.trading_date)}</text></g>)}</svg><small className="muted">Đường nối giá khớp thực tế; khoảng cách ngang theo thứ tự giao dịch, không phải nến thị trường.</small></div>
}
export function JournalDetail({entry,cycle,onClose,onEdit,onNew}:{entry:JournalEntry|null;cycle:JournalCycle|null;onClose:()=>void;onEdit:(entry:JournalEntry)=>void;onNew:(symbol:string,cycleId:string)=>void}) {
  const ref=useRef<HTMLElement>(null),close=useCallback(onClose,[onClose]);useDialogFocus(true,ref,close)
  const rows=cycle?.entries??(entry?[entry]:[])
  return <div className="sheet-backdrop journal-detail-backdrop" onMouseDown={close}><aside ref={ref} role="dialog" aria-modal="true" aria-labelledby="journal-detail-title" tabIndex={-1} className="bottom-sheet position-sheet rule-form journal-detail-sheet" onMouseDown={event=>event.stopPropagation()}><div className="sheet-title"><h2 id="journal-detail-title">{cycle?`${cycle.symbol} · Vòng giao dịch`:'Chi tiết quyết định'}</h2><button className="icon-button" aria-label="Đóng chi tiết" onClick={close}><X size={20}/></button></div>
    {cycle&&<><div className="journal-summary"><span>{formatDate(cycle.openedAt)} → {formatDate(cycle.closedAt)}</span><span>{cycle.closedAt?'Đã đóng':`Đang giữ ${cycle.quantity} CP`}</span><strong className={cycle.pnl<0?'negative':'positive'}>{formatVnd(cycle.pnl)} đã thực hiện</strong><span>R: {cycle.r?.toFixed(2)??'—'}</span></div><p>Entry: {strategyKey(cycle.entry)}<br/>Exit: {cycle.closedAt?strategyKey(cycle.exit):'Chưa đóng vòng'}</p><ExecutionPath cycle={cycle}/>
      <div className="journal-table-wrap"><table className="journal-table"><thead><tr><th>Ngày</th><th>Hành động</th><th>Khối lượng</th><th>Giá khớp</th><th>Quyết định</th></tr></thead><tbody>{cycle.transactions.map(tx=><tr key={tx.id}><td>{formatDate(tx.trading_date)}</td><td>{tx.action}</td><td>{tx.quantity}</td><td>{formatVnd(tx.price)}</td><td>{strategyKey(rows.find(note=>linkedTransaction(note)===tx.id&&note.workflow)??rows.find(note=>linkedTransaction(note)===tx.id))}</td></tr>)}</tbody></table></div>
      <button className="secondary-button" onClick={()=>onNew(cycle.symbol,cycle.id)}>Ghi diễn biến / tổng kết vòng này</button><h3>Diễn biến từ đầu đến cuối</h3></>}
    {rows.map(note=><JournalNote key={note.id} entry={note} onEdit={onEdit}/>)}
    <a className="text-button" href="#settings?guide=journal">Quy định và cách đọc thống kê Nhật ký</a>
  </aside></div>
}
