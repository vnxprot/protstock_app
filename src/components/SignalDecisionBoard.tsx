import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { formatMarketPrice } from '../lib/marketUnits'

type Row = { id:string; symbol:string; sector:string|null; action:string; state:string; score:number; count:number; timeframe:string; expiry:string|null; trigger:number|null; stop:number|null; reasons:string[] }
const stateLabel:Record<string,string>={EXTENDED:'Đã kéo xa nền',MOMENTUM_CONTINUATION:'Tiếp diễn xu hướng',WATCH_CONTEXT:'Bối cảnh theo dõi'}
const actionRank:Record<string,number>={EXIT:4,REDUCE:3,ADD:2,PROBE_BUY:1}

async function loadBoard():Promise<Row[]> {
  const {data: latest,error:latestError}=await supabase!.from('consolidated_signals').select('as_of_date').order('as_of_date',{ascending:false}).limit(1).maybeSingle()
  if(latestError) throw latestError
  if(!latest) return []
  const {data,error}=await supabase!.from('consolidated_signals').select('id,composite_action,signal_state,confluence_score,confluence_count,timeframe,expiry_date,trigger_price,invalidation_price,reasons,symbols!inner(symbol,sector)').eq('as_of_date',latest.as_of_date).order('confluence_score',{ascending:false}).limit(500)
  if(error) throw error
  return (data??[]).map((item:any)=>{const symbol=Array.isArray(item.symbols)?item.symbols[0]:item.symbols;return{id:item.id,symbol:symbol?.symbol??'—',sector:symbol?.sector??null,action:item.composite_action,state:item.signal_state,score:Number(item.confluence_score),count:Number(item.confluence_count),timeframe:item.timeframe,expiry:item.expiry_date,trigger:item.trigger_price==null?null:Number(item.trigger_price),stop:item.invalidation_price==null?null:Number(item.invalidation_price),reasons:item.reasons??[]}})
}

export function SignalDecisionBoard({onSelect}:{onSelect:(symbol:string)=>void}) {
  const query=useQuery({queryKey:['signal-decision-board'],enabled:Boolean(supabase),staleTime:60_000,queryFn:loadBoard})
  const rows=query.data??[]
  const actionable=rows.filter(row=>row.state==='ACTIONABLE'&&row.action!=='WATCH').sort((a,b)=>(actionRank[b.action]-actionRank[a.action])||(b.count-a.count)||(b.score-a.score)).slice(0,8)
  const watch=rows.filter(row=>row.action==='WATCH'&&row.state==='WATCH_SETUP').sort((a,b)=>(a.expiry??'9999').localeCompare(b.expiry??'9999')||b.score-a.score).slice(0,8)
  const context=rows.filter(row=>row.action==='WATCH'&&row.state!=='WATCH_SETUP').sort((a,b)=>b.score-a.score).slice(0,8)
  const Row=({row,kind}:{row:Row;kind:'action'|'watch'|'context'})=><a href="#analysis" className={`decision-row ${kind}`} onClick={()=>onSelect(row.symbol)}><div><strong>{row.symbol}</strong><small>{row.sector??'Chưa phân ngành'} · {row.timeframe}</small></div>{kind==='action'?<span className={`action-pill ${row.action.toLowerCase()}`}>{row.action}</span>:kind==='watch'?<span className="decision-plan">Trigger {formatMarketPrice(row.trigger)}<small>Hết hạn {row.expiry?formatDate(row.expiry):'—'}</small></span>:<span className="decision-context">{stateLabel[row.state]??'Bối cảnh'}<small>{row.reasons[0]??'Theo dõi'}</small></span>}</a>
  const Empty=({children}:{children:string})=><p className="decision-empty">{children}</p>
  return <section className="signal-decision-board" aria-label="Ba vùng quyết định tín hiệu"><article className="panel decision-zone actionable-zone"><header><div><span>01 · Hành động</span><h2>Actionable</h2><small>Chỉ tín hiệu đã qua điều kiện giao dịch.</small></div><a href="#screener">Xem tất cả</a></header>{query.isLoading?<Empty>Đang tải tín hiệu…</Empty>:actionable.length?actionable.map(row=><Row key={row.id} row={row} kind="action"/>):<Empty>Chưa có hành động mới trong phiên.</Empty>}</article><article className="panel decision-zone watch-zone"><header><div><span>02 · Chờ xác nhận</span><h2>Watchlist chất lượng</h2><small>Chỉ setup còn hiệu lực, có trigger và hạn theo dõi.</small></div><a href="#screener">Lọc setup</a></header>{watch.length?watch.map(row=><Row key={row.id} row={row} kind="watch"/>):<Empty>Chưa có setup gần trigger.</Empty>}</article><article className="panel decision-zone context-zone"><header><div><span>03 · Bối cảnh</span><h2>Market &amp; Flow</h2><small>Không phải đề xuất mua; dùng để đọc xu hướng và rủi ro.</small></div><a href="#analysis">Prot Flow</a></header>{context.length?context.map(row=><Row key={row.id} row={row} kind="context"/>):<Empty>Không có bối cảnh nổi bật trong phiên.</Empty>}</article></section>
}
