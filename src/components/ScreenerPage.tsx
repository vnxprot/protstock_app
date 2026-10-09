import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { latestSignalPublication } from '../lib/signalPublication'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { ChevronDown, Download, FileSpreadsheet, FileText, Filter, LayoutGrid, List, Search, SlidersHorizontal, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { isWatchActive, loadWatchlist, toggleWatchlistSymbol } from '../lib/watchlist'

import { SoftSelect } from './SoftSelect'
import { DateField } from './DateField'
import { canonicalEngineName, compareEngines } from '../lib/engineCatalog'
import { displayStructureName, displaySystemRevision } from '../lib/releaseLabels'
import { downloadSignalCsv, downloadSignalExcel, downloadSignalPdf } from '../lib/signalReports'
import { explainSignal, signalReasonSummary } from '../lib/signalExplanation'
import { SignalTriageList } from './SignalTriageList'
import { SignalFunnelPanel } from './SignalFunnelPanel'
import { MomentumRadarPanel, type RadarDestination } from './MomentumRadarPanel'
import { MacdDivergencePanel } from './MacdDivergencePanel'
import { DualEngineComparePanel } from './DualEngineComparePanel'
import { ChallengerResearchTab } from './ChallengerResearchTab'
import { IntradaySpikeRadar } from './IntradaySpikeRadar'
import type { TriageSignal } from '../lib/signalTriage'
type SignalRow = TriageSignal & { confluence_count:number; confluence_badge:string; consensus_engines:string[]; source_revision:string }
type WyckoffEvidence = { event_date:string; confirmed_on:string; timeframe:string; support:number; resistance:number; volume_ratio20:number; range_width_pct:number; clv:number }
type SignalResult = { rows: SignalRow[]; latestDate: string | null; total: number }
type SignalFilters = { showHistory:boolean; query:string; action:string; minScore:number; timeframe:string; engine:string; dateFrom:string; dateTo:string; exactDate:string; descending:boolean; page:number; pageSize:number }
type PricePoint = { symbol_id:string; trading_date:string; close:number; symbols?:{symbol:string}|null }

const engineLabels:Record<string,string>={core_ladder_v1:'Prot Core Engine v1.0',core_ladder_v2:'Prot Core Engine v2.0',pullback_continuation_v1:'Pullback Continuation',vcp_breakout_v1:'VCP Breakout',rsi_macd_divergence_v1:'RSI MACD Divergence',relative_strength_leader_v1:'Relative Strength Leader'}
function displayEngine(engine:string){const canonical=canonicalEngineName(engine);return displayStructureName(engineLabels[canonical]??canonical.replaceAll('_',' '))}
function revisionLabel(signal:SignalRow){return displaySystemRevision(signal.source_revision)}
function Sparkline({ points }: { points:number[] }) { const values=points.slice(-20); if(values.length<2)return <span className="sparkline-empty">Chưa đủ 20 phiên</span>; const min=Math.min(...values),max=Math.max(...values),span=max-min||1; const polyline=values.map((value,index)=>`${index/(values.length-1)*100},${92-(value-min)/span*84}`).join(' '); const rising=values.at(-1)!>=values[0]; return <svg className={`sparkline ${rising?'up':'down'}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Xu hướng giá 20 phiên"><polyline points={polyline}/></svg> }

function mapSignal(item:any):SignalRow {
  const stock=Array.isArray(item.symbols)?item.symbols[0]:item.symbols
  const count=Number(item.confluence_count)
  return {signal_id:item.id,symbol_id:Number(item.symbol_id),symbol:item.symbol??stock?.symbol??'—',sector:item.sector??stock?.sector??null,as_of_date:item.as_of_date,timeframe:item.timeframe,action:item.composite_action,state:item.signal_state,score:Number(item.confluence_score),confluence_count:count,confluence_badge:count>=3?'STRONG_ALIGNED':count===2?'HIGH_CONFLUENCE':'STANDARD',consensus_engines:item.consensus_engines??[],reasons:item.reasons??[],source_revision:item.source_revision??'legacy'}
}
async function fetchConsolidatedSignals(filters:SignalFilters,exportAll=false):Promise<SignalResult> {
  const publication=await latestSignalPublication()
  if(!filters.showHistory&&!publication)return{rows:[],latestDate:null,total:0}
  const output:SignalRow[]=[]
  let total=0
  const batch=exportAll||!filters.showHistory?1000:filters.pageSize
  for(let current=exportAll||!filters.showHistory?1:filters.page;;current++) {
    const useFilters=filters.showHistory||exportAll
    const {data,error}=await supabase!.rpc('search_consolidated_signals',{
      p_date:filters.showHistory?(filters.exactDate||null):publication!.date,p_revision:filters.showHistory?null:publication!.sourceRevision,
      p_symbol:useFilters?filters.query:'',p_action:useFilters?filters.action:'ALL',p_min_score:useFilters?filters.minScore:0,
      p_timeframe:useFilters?filters.timeframe:'ALL',p_engine:useFilters?filters.engine:'ALL',
      p_date_from:useFilters?(filters.dateFrom||null):null,p_date_to:useFilters?(filters.dateTo||null):null,
      p_page:current,p_page_size:batch,p_descending:filters.descending,
    })
    if(error)throw error
    total=Number(data.total)
    output.push(...(data.rows??[]).map(mapSignal))
    if(filters.showHistory&&!exportAll||(data.rows??[]).length<batch||output.length>=total)break
  }
  return{rows:output,latestDate:publication?.date??null,total}
}

export function ScreenerPage({ authenticated, canJournal = false }: { authenticated: boolean; canJournal?: boolean }) {
  const [engineMode,setEngineMode]=useState<'champion'|'challenger'|'compare'>('champion')
  const [tab,setTab]=useState<'original'|'watch'|'funnel'|'macd'|'radar'|'spikes'>(()=>location.hash.includes('tab=spikes')?'spikes':'original')
  const [linkedSymbol,setLinkedSymbol]=useState('')
  const [query,setQuery]=useState(''); const [action,setAction]=useState('ALL'); const [showHistory,setShowHistory]=useState(false); const showRaw=true; const minScoreText=''; const descending=true; const [page,setPage]=useState(1); const [pageSize,setPageSize]=useState(25); const [view,setView]=useState<'table'|'cards'>(()=>localStorage.getItem('protstock-screener-view')==='cards'?'cards':'table'); const [favorites,setFavorites]=useState<string[]>(()=>loadWatchlist().filter(isWatchActive).map(item=>item.symbol)); const [exportNotice,setExportNotice]=useState(''); const [exportOpen,setExportOpen]=useState(false); const [advancedOpen,setAdvancedOpen]=useState(false)
  const [explainingSignal,setExplainingSignal]=useState<SignalRow|null>(null)
  const [exporting,setExporting]=useState(false)
  const explanationRef=useRef<HTMLElement|null>(null)
  const closeExplanation=useCallback(()=>setExplainingSignal(null),[])
  useDialogFocus(Boolean(explainingSignal),explanationRef,closeExplanation)
  const [timeframe,setTimeframe]=useState('ALL'); const [engine,setEngine]=useState('ALL'); const [dateFrom,setDateFrom]=useState(''); const [dateTo,setDateTo]=useState(''); const [exactDate,setExactDate]=useState('')
  const minScore=Math.max(0,Math.min(100,Number(minScoreText)||0))
  const filters={showHistory,query,action,minScore,timeframe,engine,dateFrom,dateTo,exactDate,descending,page,pageSize}
  const wyckoffEvidence=useQuery({queryKey:['wyckoff-evidence',explainingSignal?.signal_id],enabled:authenticated&&Boolean(supabase)&&Boolean(explainingSignal?.reasons.some(reason=>reason.startsWith('WYCKOFF_'))),queryFn:async():Promise<WyckoffEvidence|null>=>{const signal=explainingSignal!;const {data,error}=await supabase!.from('signals').select('evidence').eq('symbol_id',signal.symbol_id).eq('timeframe',signal.timeframe).eq('as_of_date',signal.as_of_date);if(error)throw error;return(data??[]).map(row=>row.evidence?.wyckoff as WyckoffEvidence|undefined).find(item=>item?.event_date&&item.timeframe===signal.timeframe)??null}})
  const signals=useQuery({queryKey:['consolidated-signals',showHistory?filters:{showHistory:false}],enabled:authenticated&&Boolean(supabase),staleTime:300_000,refetchInterval:300_000,queryFn:()=>fetchConsolidatedSignals(filters)})
  const latestSignals=useQuery({queryKey:['consolidated-signals-latest-for-watch'],enabled:authenticated&&Boolean(supabase)&&showHistory&&(tab==='watch'||tab==='radar'||engineMode!=='champion'),staleTime:300_000,queryFn:()=>fetchConsolidatedSignals({...filters,showHistory:false,query:'',action:'ALL',minScore:0,timeframe:'ALL',engine:'ALL',dateFrom:'',dateTo:'',exactDate:'',page:1})})
  const activeEngines=useQuery({queryKey:['active-core-engines'],enabled:authenticated&&Boolean(supabase),queryFn:async()=>{const {data,error}=await supabase!.from('rules').select('name').eq('status','ACTIVE').ilike('name','Prot Core %');if(error)throw error;return(data??[]).map(item=>canonicalEngineName(item.name))}})
  useEffect(()=>{const sync=(event:Event)=>setFavorites((event as CustomEvent<string[]>).detail);addEventListener('protstock:favorites',sync);return()=>removeEventListener('protstock:favorites',sync)},[])
  const source=signals.data?.rows??[]
  const watchSource=showHistory?latestSignals.data?.rows??[]:source
  const latestDate=signals.data?.latestDate??null
  const engineOptions=useMemo(()=>[...new Set([...(activeEngines.data??[]),...source.flatMap(item=>item.consensus_engines.map(canonicalEngineName))])].map(name=>({name})).sort(compareEngines),[activeEngines.data,source])
  const rows=useMemo(()=>showHistory?source:source.filter(item=>{const matchesAction=action==='ALL'||action==='CONFLUENCE'&&item.confluence_count>=2||action==='BUY'&&['PROBE_BUY','ADD'].includes(item.action)||action==='SELL'&&['REDUCE','EXIT'].includes(item.action)||action==='WATCH'&&item.action==='WATCH';return(showHistory||item.as_of_date===latestDate)&&(!query||item.symbol.toLowerCase().includes(query.toLowerCase()))&&matchesAction&&item.score>=minScore&&(timeframe==='ALL'||item.timeframe===timeframe)&&(engine==='ALL'||item.consensus_engines.some(name=>canonicalEngineName(name)===engine))&&(!dateFrom||item.as_of_date>=dateFrom)&&(!dateTo||item.as_of_date<=dateTo)&&(!exactDate||item.as_of_date===exactDate)}).sort((a,b)=>b.as_of_date.localeCompare(a.as_of_date)||((b.score-a.score)*(descending?1:-1))),[source,showHistory,latestDate,query,action,minScore,descending,timeframe,engine,dateFrom,dateTo,exactDate])
  const totalMatches=showHistory?(signals.data?.total??0):rows.length; const totalPages=Math.max(1,Math.ceil(totalMatches/pageSize)); const currentPage=Math.min(page,totalPages); const visibleRows=useMemo(()=>showHistory?rows:rows.slice((currentPage-1)*pageSize,currentPage*pageSize),[rows,currentPage,pageSize,showHistory])
  useEffect(()=>{if(showHistory&&signals.isSuccess&&page>totalPages)setPage(totalPages)},[showHistory,signals.isSuccess,page,totalPages])
  const priceIds=[...new Set(visibleRows.map(item=>item.symbol_id))]
  const prices=useQuery({queryKey:['screener-sparklines',priceIds.join(',')],enabled:authenticated&&Boolean(supabase)&&priceIds.length>0&&view==='cards'&&(showHistory||showRaw),staleTime:300_000,queryFn:async()=>{const{data,error}=await supabase!.rpc('recent_symbol_prices',{p_symbol_ids:priceIds,p_sessions:20});if(error)throw error;return(data??[]) as PricePoint[]}})
  const sparklineBySymbol=useMemo(()=>{const grouped:Record<string,PricePoint[]>={};((prices.data??[]) as unknown as PricePoint[]).forEach(point=>{const symbol=source.find(item=>item.symbol_id===Number(point.symbol_id))?.symbol;if(symbol)(grouped[symbol]??=[]).push(point)});return Object.fromEntries(Object.entries(grouped).map(([symbol,items])=>[symbol,items.sort((a,b)=>a.trading_date.localeCompare(b.trading_date)).slice(-20).map(item=>Number(item.close))]))},[prices.data,source])
  useEffect(()=>setPage(1),[query,action,showHistory,minScore,descending,pageSize,timeframe,engine,dateFrom,dateTo,exactDate])
  function toggleHistory(){if(showHistory){setDateFrom('');setDateTo('');setExactDate('')}setShowHistory(value=>!value)}
  function changeHistoryDate(setter:(value:string)=>void,value:string){setter(value);if(value)setShowHistory(true)}
  function chooseChip(chip:string){setAction(chip);setPage(1)}
  function setViewMode(next:'table'|'cards'){setView(next);localStorage.setItem('protstock-screener-view',next)}
  function openChart(symbol:string){localStorage.setItem('protstock-symbol',symbol);dispatchEvent(new CustomEvent('protstock:symbol',{detail:symbol}));location.hash='analysis'}
  function openRelated(target:RadarDestination,symbol:string,mode:'champion'|'challenger'='champion'){
    if(target==='analysis'){openChart(symbol);return}
    setEngineMode(mode);setTab(target);setLinkedSymbol(symbol);setShowHistory(false)
    document.getElementById('screener-tab-'+target)?.scrollIntoView({block:'start',behavior:'smooth'})
  }
  function toggleFavorite(symbol:string){toggleWatchlistSymbol(symbol)}
  function openJournal(symbol:string){if(canJournal)location.hash=`journal?symbol=${encodeURIComponent(symbol)}`}
  async function exportSignals(format:'csv'|'excel'|'pdf') {
    if(exporting)return
    setExporting(true)
    setExportNotice('Đang lấy đầy đủ kết quả theo bộ lọc…')
    try {
      const result=await fetchConsolidatedSignals(filters,true)
      if(!result.rows.length){setExportNotice('Không có tín hiệu khớp bộ lọc để xuất.');return}
      const output=result.rows.map(x=>({symbol:x.symbol,sector:x.sector,action:x.action,timeframe:x.timeframe,score:x.score,confluenceCount:x.confluence_count,date:x.as_of_date,sourceRevision:x.source_revision,engines:x.consensus_engines.map(displayEngine).join(' / '),reasons:signalReasonSummary(x.reasons)}))
      if(format==='csv')downloadSignalCsv(output);else if(format==='excel')await downloadSignalExcel(output);else await downloadSignalPdf(output)
      setExportNotice(`Đã xuất đầy đủ ${result.total} tín hiệu theo bộ lọc hiện tại.`);setExportOpen(false)
    }catch{setExportNotice('Không thể tạo tệp xuất. Thử lại sau.')}
    finally{setExporting(false)}
  }

  const engineDetail=(signal:SignalRow)=><span className="signal-engine-detail">{[...new Set(signal.consensus_engines.map(displayEngine))].join(' · ')||'—'}<small className="signal-revision" title={signal.source_revision}>{revisionLabel(signal)}</small></span>
  const technicalDetail=(signal:SignalRow)=><span className="signal-technical-detail">{signal.reasons.join(' · ')||'—'}</span>
  const explanationDetail=(signal:SignalRow)=><span className="signal-explanation-detail"><small>{signalReasonSummary(signal.reasons)}</small><button type="button" className="signal-explain-trigger" onClick={()=>setExplainingSignal(signal)}>Vì sao?</button></span>
  const explanation=explainingSignal?explainSignal(explainingSignal.action,explainingSignal.reasons):null
  return <section className="workspace-page screener-page"><div className="page-title-row"><div><h1>Bộ lọc tín hiệu</h1><p className="muted">Tín hiệu tổng hợp mới nhất; chọn mã để xem phân tích.</p></div><div className="report-menu"><button className="secondary-button export-button" disabled={exporting} aria-busy={exporting} onClick={()=>setExportOpen(value=>!value)}><Download size={15}/> Tải kết quả <ChevronDown size={14}/></button>{exportOpen&&<div className="report-menu-popover"><button disabled={exporting} onClick={()=>void exportSignals('csv')}><Download size={16}/> Tải CSV <small>.csv · dùng nhanh</small></button><button disabled={exporting} onClick={()=>void exportSignals('excel')}><FileSpreadsheet size={16}/> Tải Excel <small>.xlsx · đầy đủ bộ lọc</small></button><button disabled={exporting} onClick={()=>void exportSignals('pdf')}><FileText size={16}/> Tải PDF <small>.pdf · bản in tóm tắt</small></button></div>}</div></div>{exportNotice&&<p className="export-notice" role="status">{exportNotice}</p>}
    <div className="timeframe-tabs screener-tabs" role="tablist" aria-label="Chế độ bộ máy">
      {([['champion','🛡️ Champion (v1.0)'],['challenger','⚡ Challenger (v2.0)'],['compare','⚔️ Đối chiếu Song mã']] as const).map(([id,label])=><button key={id} type="button" role="tab" aria-selected={engineMode===id} className={engineMode===id?'active':''} onClick={()=>setEngineMode(id)}>{label}</button>)}
    </div>
    {engineMode==='compare'&&latestDate&&<DualEngineComparePanel date={latestDate} champion={showHistory?latestSignals.data?.rows??[]:source} mode="compare"/>}
    {engineMode==='challenger'&&latestDate&&tab!=='radar'&&<DualEngineComparePanel date={latestDate} champion={showHistory?latestSignals.data?.rows??[]:source} mode={tab==='watch'?'watch':tab==='original'?'challenger':'summary'}/>}
    {engineMode!=='compare'&&<>
    <div className="timeframe-tabs screener-tabs" role="tablist" aria-label="Nhóm bảng tín hiệu">
      {([['original','Tín hiệu gốc'],['watch','WATCH cơ hội'],['radar','Radar cơ hội'],['spikes','Giao dịch đột biến'],['funnel','Phễu tháng → tuần → ngày'],['macd','Phân kỳ Dương · đường MACD']] as const).map(([id,label])=><button key={id} id={`screener-tab-${id}`} type="button" role="tab" aria-selected={tab===id} aria-controls={`screener-panel-${id}`} className={tab===id?'active':''} onClick={()=>{setTab(id);setLinkedSymbol('')}}>{label}</button>)}
    </div>
    {tab==='radar'&&(latestDate?<MomentumRadarPanel date={latestDate} championSignals={watchSource} championLoading={showHistory?latestSignals.isLoading:signals.isLoading} championError={showHistory?latestSignals.isError:signals.isError} onNavigate={openRelated}/>:<p className="muted">Chưa có phiên dữ liệu để xem Radar.</p>)}
    {tab==='spikes'&&<div id="screener-panel-spikes" role="tabpanel" aria-labelledby="screener-tab-spikes">{latestDate?<IntradaySpikeRadar date={latestDate} authenticated={authenticated} mode="screener"/>:<p className="muted">Chưa có phiên dữ liệu để xem giao dịch đột biến.</p>}</div>}
    {engineMode==='champion'&&<>
    {tab==='original'&&<div id="screener-panel-original" role="tabpanel" aria-labelledby="screener-tab-original">
    <div className="screener-filter-toolbar" aria-label="Bộ lọc tín hiệu">
      <div className="screener-filter-fields">
        <label className="screener-field screener-search"><Search size={15}/><input aria-label="Tìm mã cổ phiếu" value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm mã…"/></label>
        <label className="screener-field screener-action"><Filter size={15}/><SoftSelect aria-label="Hành động" value={action} onChange={e => chooseChip(e.target.value)}><option value="ALL">Mọi hành động</option><option value="CONFLUENCE">Đồng thuận cao</option><option value="BUY">Mua</option><option value="SELL">Bán</option><option value="WATCH">Theo dõi</option></SoftSelect></label>
      </div>
      <div className="screener-toolbar-actions">{(showHistory||showRaw)&&<div className="view-switcher screener-toolbar-view" aria-label="Chế độ xem"><button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}><List size={15}/> Bảng</button><button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')}><LayoutGrid size={15}/> Thẻ</button></div>}<button type="button" className={advancedOpen?'advanced-toggle active':'advanced-toggle'} onClick={()=>setAdvancedOpen(value=>!value)}><SlidersHorizontal size={15}/> Bộ lọc nâng cao</button></div>
      <div className="screener-toolbar-scope"><span>{showHistory?'Đang xem lịch sử tín hiệu':'Chỉ tín hiệu phiên mới nhất'}{latestDate&&<> · <b>{formatDate(latestDate)}</b></>}</span><button type="button" className="secondary-button" onClick={toggleHistory}>{showHistory?'Về phiên mới nhất':'Xem lịch sử'}</button></div>
    </div>
    {advancedOpen&&<div className="signal-search-advanced"><label>Khung<SoftSelect value={timeframe} onChange={e=>setTimeframe(e.target.value)}><option value="ALL">Mọi khung</option><option value="D">Ngày (D)</option><option value="W">Tuần (W)</option><option value="M">Tháng (M)</option></SoftSelect></label><label>Bộ máy tín hiệu<SoftSelect value={engine} onChange={e=>setEngine(e.target.value)}><option value="ALL">Tất cả bộ máy</option>{engineOptions.map(item=><option key={item.name} value={item.name}>{displayStructureName(item.name)}</option>)}</SoftSelect></label><DateField label="Từ ngày" value={dateFrom} onChange={value=>changeHistoryDate(setDateFrom,value)}/><DateField label="Đến ngày" value={dateTo} onChange={value=>changeHistoryDate(setDateTo,value)}/><DateField label="Ngày cụ thể" value={exactDate} onChange={value=>changeHistoryDate(setExactDate,value)}/><button className="secondary-button" onClick={()=>{setDateFrom('');setDateTo('');setExactDate('');setEngine('ALL');setTimeframe('ALL');setQuery('');setAction('ALL');setShowHistory(false)}}>Xóa bộ lọc</button></div>}
    {dateFrom&&dateTo&&dateFrom>dateTo&&<p className="form-error">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
    {signals.isLoading&&<p className="muted">Đang tải tín hiệu…</p>}{signals.isError&&<p className="form-error" role="alert">Không đọc được tín hiệu. <button className="text-button" onClick={()=>void signals.refetch()}>Thử lại</button></p>}
    {(showHistory||showRaw)&&<article className="panel"><div className="panel-title screener-results-heading"><h3>Kết quả tín hiệu tổng hợp v1.0</h3><div className="screener-results-tools"><span>{rows.length ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, totalMatches)} / ${totalMatches}` : 0} tín hiệu</span></div></div>{view==='table'?<div className="data-table screener-table"><div className="table-head"><span>Mã</span><span>Hành động</span><span>Khung</span><span>Đồng thuận</span><span>Bộ máy</span><span>Tín hiệu &amp; lý do</span><span>Diễn giải</span><span>Ngày</span></div>{visibleRows.map(signal=><div className="position-row screener-row" key={signal.signal_id}><strong className="screener-symbol" title="Xem phân tích" role="button" tabIndex={0} onClick={()=>openChart(signal.symbol)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openChart(signal.symbol)}}}>{signal.symbol}<small>{signal.sector}</small></strong><div className="signal-compact-meta"><span className={`action-pill ${signal.action.toLowerCase()}`}>{signal.action}</span><span className="signal-timeframe">{signal.timeframe}</span><b className="signal-confluence"><i className={`confluence-badge ${signal.confluence_badge.toLowerCase()}`}>{signal.confluence_badge.replace('_',' ')}</i><small>{signal.score}</small></b></div>{engineDetail(signal)}{technicalDetail(signal)}{explanationDetail(signal)}<span className="signal-date">{formatDate(signal.as_of_date)}</span></div>)}</div>:<div className="signal-visual-grid">{visibleRows.map(signal=><article className="signal-visual-card" key={signal.signal_id}><div className="signal-visual-head screener-symbol" title="Xem phân tích" role="button" tabIndex={0} onClick={()=>openChart(signal.symbol)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openChart(signal.symbol)}}}><div><strong>{signal.symbol}</strong><small>{signal.sector||'Chưa phân ngành'} · {signal.timeframe}</small></div><b>{signal.score}</b><time className="signal-visual-date">{formatDate(signal.as_of_date)}</time></div><div className="signal-visual-meta"><span className={`action-pill ${signal.action.toLowerCase()}`}>{signal.action}</span><i className={`confluence-badge ${signal.confluence_badge.toLowerCase()}`}>{signal.confluence_badge.replace('_',' ')}</i></div><Sparkline points={sparklineBySymbol[signal.symbol]??[]}/><div className="signal-card-details">{engineDetail(signal)}{technicalDetail(signal)}{explanationDetail(signal)}</div><div className="visual-card-actions"><button type="button" onClick={()=>openChart(signal.symbol)}>🔍 Xem biểu đồ</button><button type="button" onClick={()=>toggleFavorite(signal.symbol)}>⭐ {favorites.includes(signal.symbol)?'Bỏ theo dõi':'Theo dõi'}</button>{canJournal&&<button type="button" onClick={()=>openJournal(signal.symbol)}>📝 Ghi nhật ký</button>}</div></article>)}</div>}{rows.length>0&&<nav className="screener-pagination" aria-label="Phân trang tín hiệu"><span>Hiển thị <SoftSelect value={pageSize} onChange={event=>setPageSize(Number(event.target.value))}><option value="25">25</option><option value="50">50</option><option value="100">100</option></SoftSelect> / trang</span><div><button type="button" disabled={currentPage===1} onClick={()=>setPage(1)}>Đầu</button><button type="button" disabled={currentPage===1} onClick={()=>setPage(value=>Math.max(1,value-1))}>‹ Trước</button><b>Trang {currentPage}/{totalPages}</b><button type="button" disabled={currentPage===totalPages} onClick={()=>setPage(value=>Math.min(totalPages,value+1))}>Sau ›</button><button type="button" disabled={currentPage===totalPages} onClick={()=>setPage(totalPages)}>Cuối</button></div></nav>}{!rows.length&&<p className="muted">Chưa có consolidated signal khớp bộ lọc hiện tại.</p>}</article>}
    </div>}
    {tab==='watch'&&<div id="screener-panel-watch" role="tabpanel" aria-labelledby="screener-tab-watch">{signals.isLoading||showHistory&&latestSignals.isLoading?<p className="muted">Đang tải tín hiệu…</p>:signals.isError||showHistory&&latestSignals.isError?<p className="form-error" role="alert">Không đọc được tín hiệu WATCH. <button className="text-button" onClick={()=>void (showHistory?latestSignals:signals).refetch()}>Thử lại</button></p>:latestDate?<article className="panel"><div className="panel-title"><div><h3>WATCH cơ hội v1.0</h3><small>Thứ tự: thay đổi mới → rủi ro trong danh mục → WATCH cơ hội</small></div><small>{formatDate(latestDate)}</small></div>{linkedSymbol&&<p className="muted">Đang xem mã {linkedSymbol}. Chọn lại tab WATCH để xem toàn bộ.</p>}<SignalTriageList rows={watchSource.filter(item=>item.as_of_date===latestDate&&(!linkedSymbol||item.symbol===linkedSymbol))} allRows={watchSource} latestDate={latestDate} onExplain={signal=>setExplainingSignal(watchSource.find(item=>item.signal_id===signal.signal_id)??null)}/></article>:<p className="muted">Chưa có tín hiệu phiên mới nhất.</p>}</div>}
    {tab==='funnel'&&<div id="screener-panel-funnel" role="tabpanel" aria-labelledby="screener-tab-funnel">{latestDate?<SignalFunnelPanel date={latestDate} authenticated={authenticated} focusSymbol={linkedSymbol}/>:<p className="muted">Chưa có phiên dữ liệu để xem phễu.</p>}</div>}
    {tab==='macd'&&<div id="screener-panel-macd" role="tabpanel" aria-labelledby="screener-tab-macd">{latestDate?<MacdDivergencePanel date={latestDate} authenticated={authenticated} focusSymbol={linkedSymbol}/>:<p className="muted">Chưa có phiên dữ liệu để xem phân kỳ.</p>}</div>}
    </>}
    {engineMode==='challenger'&&<>
      {tab==='original'&&<p className="muted">Tín hiệu gốc Challenger gồm quyết định tổng hợp và năm nhánh UPTREND_CORE, SIDEWAY_RANGE, ADAPTIVE_FUNNEL, MACD_EARLY_ZONE, DOWNTREND_SPRING của cùng phiên EOD. Mỗi nhánh có kết quả T+2 riêng khi đủ tuổi.</p>}
      {tab==='watch'&&<p className="muted">WATCH là nhánh đang chờ hoặc bị cổng an toàn chặn. Lý do nằm ngay dưới hành động; nhãn chiến lược cho biết quyết định độc lập của từng nhánh. Đây không phải lệnh mua.</p>}
      {tab==='funnel'&&<div id="screener-panel-funnel" role="tabpanel" aria-labelledby="screener-tab-funnel">{latestDate?<ChallengerResearchTab date={latestDate} tab="funnel" focusSymbol={linkedSymbol}/>:<p className="muted">Chưa có phiên dữ liệu để xem phễu.</p>}</div>}
      {tab==='macd'&&<div id="screener-panel-macd" role="tabpanel" aria-labelledby="screener-tab-macd">{latestDate?<ChallengerResearchTab date={latestDate} tab="macd" focusSymbol={linkedSymbol}/>:<p className="muted">Chưa có phiên dữ liệu để xem phân kỳ.</p>}</div>}
    </>}
    </>}
    {explainingSignal&&explanation&&<div className="signal-explanation-backdrop" onMouseDown={closeExplanation}><article ref={explanationRef} tabIndex={-1} className="signal-explanation-panel" role="dialog" aria-modal="true" aria-label={`Giải thích tín hiệu ${explainingSignal.symbol}`} onMouseDown={event=>event.stopPropagation()}><header><div><span>Vì sao có tín hiệu này?</span><h2>{explainingSignal.symbol} · {explainingSignal.action}</h2><p>{explanation.actionText}</p></div><button type="button" aria-label="Đóng giải thích" onClick={closeExplanation}><X size={18}/></button></header><div className="signal-explanation-groups">{explanation.groups.map(group=><section key={group.title}><h3>{group.title}</h3>{group.items.map(item=><p key={item.code}>{item.text}</p>)}</section>)}{wyckoffEvidence.data&&<section><h3>Bằng chứng Wyckoff · {wyckoffEvidence.data.timeframe}</h3><p>Sự kiện {formatDate(wyckoffEvidence.data.event_date)} · Xác nhận {formatDate(wyckoffEvidence.data.confirmed_on)}</p><p>Hỗ trợ {wyckoffEvidence.data.support.toLocaleString('vi-VN')} · Kháng cự {wyckoffEvidence.data.resistance.toLocaleString('vi-VN')} · Độ rộng vùng {wyckoffEvidence.data.range_width_pct.toLocaleString('vi-VN')}%</p><p>Khối lượng / TB20 {wyckoffEvidence.data.volume_ratio20.toLocaleString('vi-VN')}× · Vị trí đóng cửa trong nến {(wyckoffEvidence.data.clv*100).toFixed(0)}%</p></section>}</div><details className="signal-technical-codes"><summary>Mã kỹ thuật gốc ({explainingSignal.reasons.length})</summary><code>{explainingSignal.reasons.join(' · ')}</code></details><footer>Diễn giải hỗ trợ đọc hiểu. Hành động và điểm tín hiệu vẫn do dữ liệu EOD cùng các rule đang bật quyết định.</footer></article></div>}
  </section>
}
