import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Search, Star } from 'lucide-react'
import { useStockAnalysis, useSymbols, type ClassicalCandidate, type PatternInstance, type PriceZone, type StockDecision, type TechnicalSnapshot } from '../hooks/useStockAnalysis'
import { openCommandPalette } from './CommandPalette'
import { StockChart } from './StockChart'
import { ZoneEvidence } from './ZoneEvidence'
import { formatMarketPrice } from '../lib/marketUnits'
import { isWatchActive, loadWatchlist, toggleWatchlistSymbol } from '../lib/watchlist'
import { MacdPanel } from './MacdPanel'
import { displaySystemRevision } from '../lib/releaseLabels'

const patternNames:Record<string,string>={ACCUMULATION_BASE:'Nền tích lũy',FLAT_BASE_BREAKOUT:'Nền phẳng',DOUBLE_BOTTOM:'Hai đáy',DOUBLE_TOP:'Hai đỉnh',ASCENDING_TRIANGLE:'Tam giác tăng',DESCENDING_TRIANGLE:'Tam giác giảm',SYMMETRICAL_TRIANGLE:'Tam giác cân',BULL_FLAG:'Cờ tăng',BULL_PENNANT:'Cờ đuôi nheo tăng',BEAR_FLAG:'Cờ giảm',CUP_HANDLE:'Cốc tay cầm',PULLBACK_CONTINUATION:'Nhịp hồi tiếp diễn'}
const number=(value:number|null|undefined,digits=2)=>value==null?'—':Number(value).toLocaleString('vi-VN',{maximumFractionDigits:digits})
const rangeSize:Record<string,number>={ '1M':22,'3M':66,'6M':132,'1Y':260,'3Y':780,ALL:9999 }
const exchangeLabel=(exchange:string|null|undefined)=>({HOSE:'HSX',HSX:'HSX',HNX:'HNX',UPCOM:'UPCOM'}[exchange??'']??'Đang đồng bộ sàn')
const displayDate=(value:string|null|undefined)=>value?value.split('-').reverse().join('/'):'—'
const actionName:Record<string,string>={WATCH:'Theo dõi · chưa có lệnh',PROBE_BUY:'Mua thăm dò',ADD:'Mua thêm',REDUCE:'Giảm tỷ trọng',EXIT:'Thoát vị thế'}

function generateExecutiveSummary(snapshot: TechnicalSnapshot | undefined): string {
  if (!snapshot) return 'Đang cập nhật đánh giá tổng hợp sau phiên...'
  const trend = snapshot.trend_state === 'UP' ? 'Xu hướng tăng duy trì tốt'
    : snapshot.trend_state === 'DOWN' ? 'Xu hướng điều chỉnh giảm'
    : snapshot.trend_state === 'SIDEWAYS' ? 'Trạng thái đi ngang tích lũy'
    : 'Xu hướng chưa rõ ràng'
  const flow = snapshot.cmf20 == null ? 'chưa đủ dữ liệu đánh giá áp lực giá–khối lượng'
    : snapshot.cmf20 > 0.05 ? 'áp lực mua đang chiếm ưu thế'
    : snapshot.cmf20 < -0.05 ? 'áp lực bán ngắn hạn còn cao'
    : 'áp lực mua bán ở mức cân bằng'
  return `${trend}; ${flow}. Theo dõi các mốc hỗ trợ và kháng cự trước khi quyết định vị thế.`
}

function DecisionCard({decision,asOf,timeframe}:{decision:StockDecision|null;asOf:string|undefined;timeframe:'D'|'W'|'M'}) {
  return <article className="panel analysis-decision-card"><div className="panel-title"><div><h3>Kết luận Prot v1.0 · {timeframe}</h3><small>Dữ liệu đã đóng đến {displayDate(asOf)}</small></div><span className={`action-pill ${(decision?.composite_action??'watch').toLowerCase()}`}>{decision?activityLabel(decision):'Không có signal mới'}</span></div><p>{decision?decision.reasons.slice(0,3).join(' · '):'Chỉ báo và mẫu hình bên dưới là bối cảnh; không có hành động mới cho kỳ dữ liệu này.'}</p><small title={decision?.source_revision}>{decision ? `Logic ${displaySystemRevision(decision.source_revision)} · cùng mốc dữ liệu` : 'Chưa có quyết định được công bố cho mốc dữ liệu này.'}</small></article>
}

function activityLabel(decision:StockDecision){return actionName[decision.composite_action]??decision.composite_action}

function PatternPanel({patterns,classical,asOf,timeframe}:{patterns:PatternInstance[];classical:ClassicalCandidate[];asOf:string|undefined;timeframe:'D'|'W'|'M'}) {
  const nativeTypes=new Set(patterns.filter(pattern=>pattern.state==='READY'||pattern.state==='CONFIRMED').map(pattern=>pattern.pattern_type))
  const active=[...patterns.map(pattern=>({...pattern,source:'Chart'})),...classical.filter(pattern=>!nativeTypes.has(pattern.pattern_type)).map((pattern,index)=>({...pattern,id:`core-${index}`,confirmed_at:null,source:'Core v0'}))].filter(pattern=>pattern.state==='READY'||pattern.state==='CONFIRMED')
  const bullish=active.filter(pattern=>pattern.direction==='BULLISH').sort((a,b)=>b.quality_score-a.quality_score)
  const bearish=active.filter(pattern=>pattern.direction==='BEARISH').sort((a,b)=>b.quality_score-a.quality_score)
  const groups=[{title:'Cấu trúc tăng',items:bullish,tone:'bullish'},{title:'Rủi ro giảm',items:bearish,tone:'bearish'}]
  return <article className="panel pattern-context-panel"><div className="panel-title"><div><h3>Mẫu hình · {timeframe}</h3><small>Nến đã đóng {displayDate(asOf)} · điểm đo cấu trúc, không phải xác suất</small></div><span>{active.length} cấu trúc</span></div>{bullish.length>0&&bearish.length>0&&<p className="pattern-conflict-note">Có kịch bản tăng và giảm cùng tồn tại. READY chưa xác nhận hướng; chờ giá phá ngưỡng tương ứng.</p>}<div className="pattern-context-grid">{groups.map(group=><section className={`pattern-context-group ${group.tone}`} key={group.title}><h4>{group.title}</h4>{group.items.length?group.items.slice(0,2).map(pattern=><div className="pattern-context-item" key={pattern.id}><div><strong>{patternNames[pattern.pattern_type]??pattern.pattern_type}</strong><span className="pattern-state">{pattern.state==='CONFIRMED'?'Đã xác nhận':'Chờ xác nhận'}</span></div><small>{pattern.source} · Cấu trúc {number(pattern.quality_score,0)} · Ngưỡng {formatMarketPrice(pattern.trigger_price)}</small>{pattern.confirmed_at&&<small>Xác nhận lần đầu {displayDate(pattern.confirmed_at)}</small>}<details><summary>Chi tiết kỹ thuật</summary><code>{pattern.reasons.join(' · ')}</code></details></div>):<p className="muted">Chưa có cấu trúc {group.tone==='bullish'?'tăng':'giảm'} đủ trạng thái theo dõi.</p>}</section>)}</div></article>
}

const zoneContextCopy:Record<string,{title:string;message:string}>={
  UP:{title:'Xu hướng tăng',message:'Hỗ trợ là vùng theo dõi nhịp hồi; kháng cự là mốc cần vượt bằng xác nhận, không phải lệnh bán tự động.'},
  DOWN:{title:'Xu hướng giảm',message:'Kháng cự phía trên là vùng hồi kỹ thuật có thể gặp cung. Không xem đó là tín hiệu mua; hỗ trợ chỉ là mốc quản trị rủi ro đến khi có xác nhận.'},
  SIDEWAYS:{title:'Xu hướng đi ngang',message:'Theo dõi biên hỗ trợ–kháng cự. Một vùng chỉ trở thành breakout khi giá đóng cửa vượt vùng và có xác nhận khối lượng.'},
  UNKNOWN:{title:'Xu hướng chưa rõ',message:'Vùng giá là mốc tham chiếu; cần thêm dữ liệu xu hướng trước khi dùng làm luận điểm giao dịch.'},
}
function zoneDistance(zone:PriceZone, close:number|null|undefined) {
  if (!close || close<=0) return 'Chưa có giá đóng cửa'
  if (close>=zone.lower_price&&close<=zone.upper_price) return 'Giá đang trong vùng'
  const boundary=zone.zone_type==='SUPPORT'?zone.upper_price:zone.lower_price
  const distance=Math.abs(close-boundary)/close*100
  return `${number(distance,1)}% phía ${zone.zone_type==='SUPPORT'?'dưới':'trên'}`
}
function FlowCard({snapshot,timeframe}:{snapshot:{as_of_date?:string;flow_score?:number|null;flow_state?:string;cmf20?:number|null;obv_slope20?:number|null;flow_volume_ratio20?:number|null;flow_clv?:number|null}|undefined;timeframe:'D'|'W'|'M'}) {
  const state=snapshot?.flow_state??"UNKNOWN"
  const title=state==="PURPLE"?"Áp lực mua rất mạnh":state==="GREEN"?"Áp lực mua":state==="BLUE"?"Áp lực bán rất mạnh":state==="RED"?"Áp lực bán":state==="NEUTRAL"?"Áp lực cân bằng":"Chưa đủ dữ liệu"
  const unit=timeframe==='D'?'phiên':timeframe==='W'?'tuần':'tháng'
  const date=snapshot?.as_of_date?.split('-').reverse().join('/')??'—'
  const score=snapshot?.flow_score
  const context=score==null?'Chưa đủ dữ liệu':score>0?'Thiên về tích lũy':score<0?'Thiên về phân phối':'Cân bằng'
  return <article className="panel flow-card"><div className="panel-title"><div><h3>Prot Flow v1.0</h3><small>Áp lực giá–khối lượng · khung {timeframe} · {date}</small></div><b className={"flow-state "+state.toLowerCase()}>{state}</b></div><div className="flow-panels"><div className="flow-context"><span>Bối cảnh 20 {unit}</span><div><strong>{score==null?'—':`${score>0?'+':''}${number(score,1)}`}</strong><b>{context}</b></div><small>CMF {number(snapshot?.cmf20,3)} · OBV {number(snapshot?.obv_slope20,3)}</small></div><div className="flow-session"><span>{timeframe==='D'?'Phiên':timeframe==='W'?'Tuần':'Tháng'} kết thúc {date}</span><strong>{title}</strong><small>KL/TB20 {number(snapshot?.flow_volume_ratio20,2)}× · CLV {number(snapshot?.flow_clv,2)}</small></div></div><small className="flow-caveat">Màu chỉ phản ánh áp lực của nến gần nhất; điểm phản ánh 20 nến. Không xác định danh tính dòng tiền và không tự tạo lệnh.</small></article>
}

function ZoneMap({zones,close,trend,timeframe}:{zones:PriceZone[];close:number|null|undefined;trend:string|undefined;timeframe:string}) {
  const state=zoneContextCopy[trend??'']?trend??'UNKNOWN':'UNKNOWN'; const context=zoneContextCopy[state]
  const ranked=(kind:PriceZone['zone_type'])=>zones.filter(zone=>zone.zone_type===kind).sort((a,b)=>{const distance=(zone:PriceZone)=>!close?Infinity:Math.min(Math.abs(close-zone.lower_price),Math.abs(close-zone.upper_price));return distance(a)-distance(b)||b.strength-a.strength}).slice(0,3)
  const groups:[PriceZone['zone_type'],string,string][]=[['RESISTANCE','Kháng cự gần giá','Vùng cản phía trên'],['SUPPORT','Hỗ trợ gần giá','Vùng đệm phía dưới']]
  return <article className={`panel zone-panel zone-context-${state.toLowerCase()}`}><div className="panel-title"><div><h3>Hỗ trợ · kháng cự</h3><small>Bản đồ vùng giá · khung {timeframe} · VND/cổ phiếu</small></div><span>{zones.length} vùng</span></div><div className="zone-context-copy"><b>{context.title}</b><p>{context.message}</p></div><div className="zone-groups">{groups.map(([kind,title,subtitle])=>{const items=ranked(kind);return <section className={`zone-group ${kind.toLowerCase()}`} key={kind}><div className="zone-group-heading"><div><strong>{title}</strong><small>{subtitle}</small></div><span>{items.length}/3</span></div>{items.length?<div className="zone-list">{items.map(zone=><div className={`zone-card ${zone.zone_type==='SUPPORT'?'support':'resistance'}`} key={zone.id}><div className="zone-card-main"><span className="zone-kind">{zone.zone_type==='SUPPORT'?'Hỗ trợ':'Kháng cự'} · {zoneDistance(zone,close)}</span><strong>{formatMarketPrice(zone.lower_price)} <i>—</i> {formatMarketPrice(zone.upper_price)}</strong></div><div className="zone-meta"><span className="zone-touches"><b>{zone.touches}</b><small>lần chạm</small></span><span>Độ mạnh {number(zone.strength,0)}</span></div><ZoneEvidence zone={zone}/></div>)}</div>:<p className="zone-empty">{kind==='SUPPORT'?'Chưa có hỗ trợ đủ pivot để xác nhận.':'Chưa có kháng cự đủ pivot để xác nhận.'}</p>}</section>})}</div></article>
}

export function AnalysisPage({authenticated}:{authenticated:boolean;canJournal?:boolean}) {
  const symbols=useSymbols(authenticated); const [selected,setSelected]=useState<string|null>(()=>localStorage.getItem('protstock-symbol')); const [favorites,setFavorites]=useState<string[]>(()=>loadWatchlist().filter(isWatchActive).map(item=>item.symbol)); const [timeframe,setTimeframe]=useState<'D'|'W'|'M'>('D'); const [range,setRange]=useState('1Y'); const [historyLimit,setHistoryLimit]=useState(500); const [multiPane,setMultiPane]=useState(()=>localStorage.getItem('protstock-chart-mode')==='triple'); const [indicators,setIndicators]=useState({ma20:true,ma50:true,ma200:false,bollinger:false,rsi:true,macd:false})
  useEffect(()=>{ if(!selected&&symbols.data?.length)setSelected(symbols.data.find(x=>x.symbol==='FPT')?.symbol??symbols.data[0].symbol) },[selected,symbols.data])
  useEffect(()=>{ const listener=(e:Event)=>setSelected((e as CustomEvent).detail); const favoriteListener=(e:Event)=>setFavorites((e as CustomEvent).detail); addEventListener('protstock:symbol',listener); addEventListener('protstock:favorites',favoriteListener); return()=>{removeEventListener('protstock:symbol',listener);removeEventListener('protstock:favorites',favoriteListener)} },[])
  const dailyAnalysis=useStockAnalysis(selected,'D',authenticated,historyLimit); const weeklyAnalysis=useStockAnalysis(selected,'W',authenticated,historyLimit); const monthlyAnalysis=useStockAnalysis(selected,'M',authenticated,historyLimit); const analysis={D:dailyAnalysis,W:weeklyAnalysis,M:monthlyAnalysis}[timeframe]; const snapshot=analysis.data?.technical[0]; const bars=useMemo(()=>analysis.data?.prices.slice(-rangeSize[range])??[],[analysis.data?.prices,range])
  const closedBars=bars.filter(bar=>bar.is_complete!==false)
  const changePct = closedBars.length>=2 ? (closedBars[closedBars.length-1].close-closedBars[closedBars.length-2].close)/closedBars[closedBars.length-2].close*100 : null
  const formingBar=timeframe!=='D'&&bars.at(-1)?.is_complete===false?bars.at(-1):null
  const toggle=(key:keyof typeof indicators)=>setIndicators(value=>({...value,[key]:!value[key]})); const toggleFavorite=()=>{if(selected)toggleWatchlistSymbol(selected)}
  const chipValue: Record<string, number | null | undefined> = { ma20: snapshot?.sma20, ma50: snapshot?.sma50, ma200: snapshot?.sma200, rsi: snapshot?.rsi14, macd: snapshot?.macd }
  return <section className="workspace-page"><div className="page-title-row"><div><h1>Phân tích mã</h1></div><div className="symbol-picker"><span>Mã cổ phiếu</span><div className="symbol-picker-actions"><button type="button" className={favorites.includes(selected??'')?'star quick-star active':'star quick-star'} aria-label="Thêm mã vào watchlist" onClick={toggleFavorite}><Star size={18} fill={favorites.includes(selected??'')?'currentColor':'none'}/></button><button type="button" onClick={()=>openCommandPalette('symbols')}><span><Search size={16}/> {selected??'Chọn mã'}</span><ChevronDown size={16}/></button></div></div></div>
    <div className="chart-toolbar"><div className="chart-tools" aria-label="Khoảng thời gian">{['1M','3M','6M','1Y','3Y','ALL'].map(item=><button className={range===item?'active':''} onClick={()=>{setRange(item);if(item==='3Y')setHistoryLimit(2600)}} key={item}>{item==='ALL'?'Tất cả':item}</button>)}</div><div className="chart-tools" aria-label="Khung nến">{([['D','Ngày'],['W','Tuần'],['M','Tháng']] as const).map(([v,l])=><button className={timeframe===v&&!multiPane?'active':''} onClick={()=>{setTimeframe(v);setMultiPane(false);localStorage.setItem('protstock-chart-mode','single')}} key={v}>{l}</button>)}<button className={multiPane?'active':''} onClick={()=>setMultiPane(value=>{const next=!value;localStorage.setItem('protstock-chart-mode',next?'triple':'single');return next})}>M/W/D</button></div></div>
    {analysis.isLoading&&<div className="skeleton-page"><div className="skeleton skeleton-card"/><div className="skeleton-grid">{[1,2,3,4].map(i=><div className="skeleton" key={i}/>)}</div></div>}{analysis.isError&&<div className="empty-state warning">Chưa tải được dữ liệu phân tích. <button className="text-button" onClick={()=>void analysis.refetch()}>Thử lại</button></div>}
    {!authenticated&&!analysis.data&&<div className="empty-state"><Search size={25}/><h3>Workspace phân tích đã sẵn sàng</h3><p>Kết nối dữ liệu để xem biểu đồ, mẫu hình và vùng giá của các mã đang theo dõi.</p></div>}
    {analysis.data&&<><div className="stock-heading"><div><h2>{analysis.data.symbol.symbol}<span className="sector-label">{analysis.data.symbol.sector}</span></h2><p>{analysis.data.symbol.company_name||'Chưa đồng bộ tên doanh nghiệp'} · {exchangeLabel(analysis.data.symbol.exchange)}</p></div><div className={`trend-badge ${snapshot?.trend_state?.toLowerCase()??''}`}>{snapshot?.trend_state??'CHƯA CÓ SNAPSHOT'}</div></div>
      {analysis.data.historyTruncated&&<p className="data-status-message">Đang xem lịch sử gần nhất để tải nhanh. <button className="text-button" disabled={analysis.isFetching} onClick={()=>setHistoryLimit(2600)}>Tải toàn bộ lịch sử</button></p>}
      <div className="chart-toolbar indicator-toolbar"><div className="chart-tools">{([['ma20','MA20'],['ma50','MA50'],['ma200','MA200'],['bollinger','Bollinger'],['rsi','RSI'],['macd','MACD']] as const).map(([key,label])=>{const value=chipValue[key];const display=key==='rsi'?number(value):formatMarketPrice(value);return <button key={key} className={indicators[key]?'active':''} onClick={()=>toggle(key)}>{label}{indicators[key]&&value!=null?<b>{display}</b>:null}</button>})}</div></div>
      {multiPane?<div className="multi-chart-studio">{([['M','Tháng'],['W','Tuần'],['D','Ngày']] as const).map(([pane,paneLabel])=>{const paneAnalysis={D:dailyAnalysis,W:weeklyAnalysis,M:monthlyAnalysis}[pane];const paneBars=paneAnalysis.data?.prices.slice(-(pane==='M'?60:pane==='W'?156:260))??[];return <article className="multi-chart-pane" key={pane}><div className="multi-chart-pane-title"><span>{pane}</span><strong>Khung {paneLabel}</strong><small>{paneBars.length} nến · đồng bộ con trỏ</small></div>{paneBars.length?<StockChart bars={paneBars} zones={paneAnalysis.data?.zones} patterns={paneAnalysis.data?.patterns} indicators={indicators} paneId={pane} paneLabel={`Khung ${paneLabel}`}/>:<div className="empty-state compact">Chưa có dữ liệu {paneLabel.toLowerCase()}.</div>}</article>})}</div>:bars.length?<StockChart bars={bars} zones={analysis.data.zones} patterns={analysis.data.patterns} indicators={indicators} paneId={timeframe} paneLabel={`Khung ${timeframe}`}/>:<div className="empty-state">Chưa có OHLCV. Pipeline EOD sẽ điền dữ liệu sau phiên.</div>}
      {indicators.macd && <MacdPanel bars={dailyAnalysis.data?.prices ?? []}/>}
      <div className="analysis-executive-takeaway" role="note"><span className="takeaway-tag">💡 Tóm lược nhanh</span><p>{generateExecutiveSummary(snapshot)}</p></div>
      <div className="metric-grid">{[['Đóng cửa',snapshot?.close,false,true],['Thay đổi phiên',changePct,true,false],['ATR 14',snapshot?.atr14,false,true],['Volume / TB20',snapshot?.volume_ratio20,false,false]].map(([label,value,isPct,isPrice])=><article className="metric-card" key={label as string}><span>{label}</span><strong className={isPct&&typeof value==='number'?(value<0?'negative':'positive'):undefined}>{isPct&&typeof value==='number'?`${value>=0?'+':''}${value.toFixed(2)}%`:isPrice?formatMarketPrice(value as number|null):number(value as number|null)}</strong></article>)}</div>
      {formingBar&&<div className="forming-period-note">Nến {timeframe==='W'?'tuần':'tháng'} đến {displayDate(formingBar.trading_date)} đang hình thành trên chart. Chỉ báo, mẫu hình và kết luận bên dưới dùng nến đã đóng đến {displayDate(snapshot?.as_of_date)}.</div>}
      <DecisionCard decision={analysis.data.decision} asOf={snapshot?.as_of_date} timeframe={timeframe}/>
      <FlowCard snapshot={snapshot} timeframe={timeframe}/><div className="analysis-columns"><PatternPanel patterns={analysis.data.patterns} classical={snapshot?.classical_candidates??[]} asOf={snapshot?.as_of_date} timeframe={timeframe}/>{analysis.data.zones.length?<ZoneMap zones={analysis.data.zones} close={snapshot?.close} trend={snapshot?.trend_state} timeframe={timeframe}/>:<article className="panel zone-panel"><div className="panel-title"><h3>Hỗ trợ · kháng cự</h3></div><p className="muted">Chưa xác định được vùng giá đủ mạnh.</p></article>}</div>
      <article className="panel"><div className="panel-title"><h3>Luận điểm hệ thống</h3><span>GIẢI THÍCH</span></div><ul className="reason-list"><li>Xu hướng D/W/M được đánh giá độc lập.</li><li>Mẫu hình là bằng chứng bổ sung, không tự phát tín hiệu.</li><li>Breakout cần đóng cửa ngoài vùng cản.</li><li>Dữ liệu chỉ dùng từ ngày <code>available_from</code>.</li></ul></article>
    </>}</section>
}
