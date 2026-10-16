import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'
import { adherenceLabels, cycleStatistics, journalRoles, journalSources, strategyKey, wilsonInterval, type JournalCycle, type JournalEntry } from '../lib/journalModel'
import { SoftSelect } from './SoftSelect'

export type ForwardResult = {id:string;state:string;sessions:number;end_date:string|null;return_pct:number|null;success:boolean|null}
export const forwardState:Record<string,string>={READY:'Đủ kỳ',PENDING:'Chưa đủ kỳ',MISSING_BASELINE:'Thiếu giá gốc',MISSING_DATA:'Thiếu phiên giá',BASIS_CHANGED:'Chuỗi giá thay đổi'}
const number=(value:number|null,digits=1)=>value==null?'—':value.toLocaleString('vi-VN',{maximumFractionDigits:digits})
export const percent=(value:number|null)=>value==null?'—':`${number(value)}%`
export function JournalReports({userId,cycles,entries,onOpenCycle}:{userId:string;cycles:JournalCycle[];entries:JournalEntry[];onOpenCycle:(id:string)=>void}) {
  const [mode,setMode]=useState<'trades'|'signals'|'decisions'>('trades'),[dimension,setDimension]=useState('strategy'),[selected,setSelected]=useState<string|null>(null)
  const forward=useQuery({queryKey:['journal-forward',userId],enabled:mode!=='trades'&&Boolean(supabase),queryFn:async()=>{const {data,error}=await supabase!.rpc('journal_forward_results');if(error)throw error;return data as ForwardResult[]}})
  const keyFor=(entry?:JournalEntry)=>{
    if(dimension==='source')return journalSources[entry?.workflow?.source??(entry?.transaction_id?'PORTFOLIO':'UNKNOWN')]
    if(dimension==='role')return journalRoles[entry?.workflow?.role??'UNKNOWN']
    if(dimension==='adherence')return adherenceLabels[entry?.workflow?.adherence??'UNKNOWN']
    if(dimension==='market')return entry?.market_state||'Chưa xác định'
    return `${strategyKey(entry)} · ${journalRoles[entry?.workflow?.role??'UNKNOWN']}${entry?.workflow?.classification_timing==='RETROSPECTIVE'?' · Phân loại hồi cứu':''}`
  }
  const groups=new Map<string,JournalCycle[]>()
  for(const cycle of cycles) {
    const keys=dimension==='entry_exit'?[`${strategyKey(cycle.entry)} → ${strategyKey(cycle.exit)}`]:dimension==='support'?(cycle.entry?.workflow?.support.length?cycle.entry.workflow.support:['Chưa gắn bằng chứng']):[keyFor(cycle.entry)]
    for(const key of keys)groups.set(key,[...(groups.get(key)??[]),cycle])
  }
  const rows=[...groups].map(([key,items])=>({key,items,...cycleStatistics(items)})).sort((a,b)=>b.n-a.n||a.key.localeCompare(b.key))
  const filteredEntries=entries.filter(entry=>mode==='decisions'?['HOLD','WAIT','SKIP'].includes(entry.decision):['BUY','SELL','STOP'].includes(entry.decision))
  const resultById=new Map((forward.data??[]).map(result=>[result.id,result]))
  const observations=new Map<string,Array<{entry:JournalEntry;result:ForwardResult}>>()
  for(const entry of filteredEntries) {
    const rule=entry.workflow?.evaluation,result=resultById.get(entry.id)
    if(!rule||!result)continue
    const key=`${keyFor(entry)} · ${entry.decision} · ${rule.direction==='UP'?'Tăng':'Giảm'} ≥${rule.threshold}% / ${rule.horizon} phiên`
    observations.set(key,[...(observations.get(key)??[]),{entry,result}])
  }
  const totals=cycleStatistics(cycles)
  return <article className="panel journal-reports"><div className="panel-title"><h2>Hiệu quả chiến lược</h2><label className="screener-field">Nhóm theo<SoftSelect value={dimension} onChange={event=>{setDimension(event.target.value);setSelected(null)}}>{[['strategy','Chiến lược + phiên bản'],['source','Nguồn phát hiện'],['role','Champion / Challenger'],['adherence','Tuân thủ'],['market','Bối cảnh thị trường'],['entry_exit','Chiến lược entry → exit'],['support','Bằng chứng hỗ trợ']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</SoftSelect></label></div>
    <div className="timeframe-tabs" role="group" aria-label="Loại hiệu quả">{([['trades','Giao dịch thực'],['signals','Tín hiệu đã ghi'],['decisions','HOLD / WAIT / SKIP']] as const).map(([key,label])=><button key={key} type="button" className={mode===key?'active':''} aria-pressed={mode===key} onClick={()=>{setMode(key);setSelected(null)}}>{label}</button>)}</div>
    {mode==='trades'?<><div className="journal-summary"><span>{totals.n} vòng đã đóng</span><span>Lãi/lỗ ròng <strong className={totals.pnl<0?'negative':'positive'}>{formatVnd(totals.pnl)}</strong></span><span>Kỳ vọng / vòng <strong>{formatVnd(totals.expectancy)}</strong></span><span>Profit factor <strong>{number(totals.profitFactor,2)}</strong></span></div>
      <p className="muted">Mỗi vòng đóng là một mẫu; bán từng phần không tăng số mẫu. Chi phí theo cấu hình danh mục, ưu tiên phí thực đã nhập. Nhóm theo nguồn, vai trò hoặc bối cảnh là so sánh mô tả, có thể khác điều kiện thị trường.{dimension==='support'?' Các nhóm bằng chứng có thể trùng vòng; không cộng tổng các hàng.':''}</p>
      <div className="journal-table-wrap"><table className="journal-table"><thead><tr><th>Nhóm</th><th>Đã đóng / tổng</th><th>Thắng</th><th>Khoảng 95%</th><th>Lãi/lỗ ròng</th><th>Kỳ vọng / vòng</th><th>Profit factor</th><th>R TB / số mẫu R</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><td><button type="button" className="text-button" onClick={()=>setSelected(selected===row.key?null:row.key)}>{row.key}</button>{row.n<30&&<small>Mẫu ít · chưa kết luận</small>}</td><td>{row.n} / {row.items.length}</td><td>{percent(row.winRate)}</td><td>{row.interval?`${number(row.interval[0])}–${number(row.interval[1])}%`:'—'}</td><td className={row.pnl<0?'negative':'positive'}>{row.n?formatVnd(row.pnl):'—'}</td><td>{formatVnd(row.expectancy)}</td><td>{number(row.profitFactor,2)}</td><td>{number(row.avgR,2)} / {row.rSamples}</td></tr>)}</tbody></table></div>
      {!rows.length&&<p className="muted">Chưa có vòng giao dịch khớp bộ lọc.</p>}
      {selected&&<div className="journal-report-drill"><h3>{selected}</h3>{groups.get(selected)?.map(cycle=><button key={cycle.id} type="button" className="secondary-button" onClick={()=>onOpenCycle(cycle.id)}>{cycle.symbol} · {formatDate(cycle.openedAt)} → {formatDate(cycle.closedAt)} · {cycle.closedAt?formatVnd(cycle.pnl):'Đang mở'}</button>)}</div>}
      <p className="muted">Hòa vốn tính khi lãi/lỗ ròng bằng 0, không tính thắng. R chỉ có khi mọi lần mua ghi stop trước hoặc trong ngày thực hiện; tổng rủi ro = Σ (giá mua − stop) × khối lượng. Profit factor hiện “—” nếu chưa có tổng lỗ. Khoảng 95% dùng Wilson trên tỷ lệ vòng thắng, chưa điều chỉnh tương quan giữa các giao dịch.</p>
    </>:<>
      <p className="muted">Chỉ các quyết định đã đăng ký tiêu chí lúc lưu; đo từ Close gốc đến Close sau 5/10/20 phiên thị trường, bắt đầu sau ngày lưu. Không giả định khớp lệnh, chưa gồm phí. Các lần ghi cùng mã có thể trùng cửa sổ nên không phải mẫu độc lập.</p>
      {forward.isLoading?<p role="status">Đang đọc kết quả sau phiên…</p>:forward.isError?<p role="alert" className="form-error">Chưa tải được kết quả. <button className="text-button" onClick={()=>void forward.refetch()}>Thử lại</button></p>:<>
        <div className="journal-table-wrap"><table className="journal-table"><thead><tr><th>Nhóm · tiêu chí đã khóa</th><th>Đủ kỳ / đăng ký</th><th>Đạt tiêu chí</th><th>Khoảng 95%</th><th>Biến động giá TB</th></tr></thead><tbody>{[...observations].map(([key,items])=>{const ready=items.filter(item=>item.result.state==='READY'),wins=ready.filter(item=>item.result.success).length,interval=wilsonInterval(wins,ready.length);return <tr key={key}><td><button className="text-button" onClick={()=>setSelected(selected===key?null:key)}>{key}</button>{ready.length<30&&<small>Mẫu ít · chưa kết luận</small>}</td><td>{ready.length} / {items.length}</td><td>{ready.length?percent(wins/ready.length*100):'—'}</td><td>{interval?`${number(interval[0])}–${number(interval[1])}%`:'—'}</td><td>{ready.length?percent(ready.reduce((sum,item)=>sum+(item.result.return_pct??0),0)/ready.length):'—'}</td></tr>})}</tbody></table></div>
        {!observations.size&&<p className="muted">Chưa có quyết định đăng ký đánh giá trong bộ lọc này. Bật đánh giá khi ghi một quyết định mới.</p>}
        {selected&&observations.has(selected)&&<div className="journal-report-drill"><h3>{selected}</h3>{observations.get(selected)!.map(({entry,result})=><p key={entry.id}>{entry.symbols?.symbol} · {formatDate(entry.decision_date)} · {forwardState[result.state]??result.state} · {result.sessions} phiên · {percent(result.return_pct)}</p>)}</div>}
      </>}
      <p className="muted">Thiếu giá gốc, thiếu phiên hoặc đổi cơ sở dữ liệu giá đều không được tính đạt/trượt. Chiến lược entry/exit và nhóm bằng chứng chỉ dùng trong bảng giao dịch thực; bảng quan sát nhóm theo chiến lược khi chọn hai chiều này.</p>
    </>}
  </article>
}
