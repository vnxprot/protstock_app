import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search, Star } from 'lucide-react'
import { CardHeader } from './CardHeader'
import { OpportunityAnalysis } from './OpportunitiesPanel'
import { useOpportunityRoute } from '../lib/opportunities'
import { useStockAnalysis, useSymbols, type ClassicalCandidate, type PatternInstance, type PriceZone, type StockDecision, type TechnicalSnapshot } from '../hooks/useStockAnalysis'
import { openCommandPalette } from './CommandPalette'
import { StockChart } from './StockChart'
import { ZoneEvidence } from './ZoneEvidence'
import { formatMarketPrice } from '../lib/marketUnits'
import { isWatchActive, loadWatchlist, toggleWatchlistSymbol } from '../lib/watchlist'
import { MacdPanel } from './MacdPanel'
import { ExRightsCalculator } from './ExRightsCalculator'
import { MonthlyTrendEvidence, type MonthlyEvidence } from './MonthlyTrendEvidence'
import { AnalysisDetails, type AnalysisDetail, type OpenAnalysisDetails } from './AnalysisDetails'
import { VciCompanyCard } from './VciCompanyCard'

const patternNames: Record<string, string> = { ACCUMULATION_BASE:'Nền tích lũy', FLAT_BASE_BREAKOUT:'Nền phẳng', DOUBLE_BOTTOM:'Hai đáy', DOUBLE_TOP:'Hai đỉnh', ASCENDING_TRIANGLE:'Tam giác tăng', DESCENDING_TRIANGLE:'Tam giác giảm', SYMMETRICAL_TRIANGLE:'Tam giác cân', BULL_FLAG:'Cờ tăng', BULL_PENNANT:'Cờ đuôi nheo tăng', BEAR_FLAG:'Cờ giảm', CUP_HANDLE:'Cốc tay cầm', PULLBACK_CONTINUATION:'Nhịp hồi tiếp diễn' }
const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits })
const rangeSize: Record<string, number> = { '1M':22, '3M':66, '6M':132, '1Y':260, '3Y':780, ALL:9999 }
const exchangeLabel = (exchange: string | null | undefined) => ({ HOSE:'HSX', HSX:'HSX', HNX:'HNX', UPCOM:'UPCOM' }[exchange ?? ''] ?? 'Đang đồng bộ sàn')
const displayDate = (value: string | null | undefined) => value ? value.split('-').reverse().join('/') : '—'
const actionName: Record<string, string> = { WATCH:'Theo dõi · chưa có lệnh', PROBE_BUY:'Mua thăm dò', ADD:'Mua thêm', REDUCE:'Giảm tỷ trọng', EXIT:'Thoát vị thế' }
const trendName: Record<string, string> = { UP:'Xu hướng tăng', DOWN:'Xu hướng giảm', SIDEWAYS:'Đi ngang', UNKNOWN:'Chưa rõ xu hướng' }
const zoneContext: Record<string, string> = {
  UP:'Hỗ trợ là vùng theo dõi nhịp hồi; kháng cự cần xác nhận khi vượt, không phải lệnh bán tự động.',
  DOWN:'Vùng kháng cự có thể gặp cung. Hỗ trợ là mốc quản trị rủi ro, chưa phải tín hiệu mua.',
  SIDEWAYS:'Theo dõi biên hỗ trợ–kháng cự; breakout cần giá đóng cửa vượt vùng và xác nhận khối lượng.',
  UNKNOWN:'Vùng giá là tham chiếu; cần thêm dữ liệu xu hướng trước khi dùng làm luận điểm giao dịch.',
}

function Card({ title, subtitle, action, onDetails, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; onDetails?: () => void; children: ReactNode; className?: string }) {
  return <article className={`panel quant-card ${className}`}><CardHeader title={title} subtitle={subtitle} status={action} onDetails={onDetails}/>{children}</article>
}

function executiveSummary(snapshot: TechnicalSnapshot | undefined) {
  const trend = trendName[snapshot?.trend_state ?? 'UNKNOWN'] ?? trendName.UNKNOWN
  const flow = snapshot?.cmf20 == null ? 'chưa đủ dữ liệu áp lực giá–khối lượng' : snapshot.cmf20 > .05 ? 'áp lực mua chiếm ưu thế' : snapshot.cmf20 < -.05 ? 'áp lực bán còn cao' : 'áp lực mua bán cân bằng'
  return `${trend}; ${flow}.`
}

function DecisionCard({ decision, snapshot, timeframe, onDetails }: { decision: StockDecision | null; snapshot: TechnicalSnapshot | undefined; timeframe: 'D' | 'W' | 'M'; onDetails: OpenAnalysisDetails }) {
  return <Card title="Kết luận hệ thống" subtitle={`${timeframe} · Nến đóng ${displayDate(snapshot?.as_of_date)}`} action={<span className={`quant-status action-${(decision?.composite_action ?? 'WATCH').toLowerCase()}`}>{decision ? actionName[decision.composite_action] ?? decision.composite_action : 'Chưa có tín hiệu mới'}</span>} onDetails={() => onDetails('Kết luận và cơ sở đánh giá', <><p>{executiveSummary(snapshot)}</p><ul>{decision?.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><p>{decision ? 'Cùng mốc dữ liệu' : 'Chưa có quyết định được công bố cho mốc dữ liệu này.'}</p><p>Theo dõi hỗ trợ, kháng cự và rủi ro trước khi quyết định vị thế.</p></>)}>
    <p className="quant-takeaway">{executiveSummary(snapshot)}</p>
    <p>{decision?.reasons.slice(0, 3).join(' · ') || 'Chỉ báo và mẫu hình là bối cảnh; chưa có hành động mới cho kỳ dữ liệu này.'}</p>
    <p className="quant-caption">{decision ? 'Cùng mốc dữ liệu' : 'Chưa có quyết định được công bố cho mốc dữ liệu này.'}</p>
  </Card>
}

function zoneDistance(zone: PriceZone, close: number | null | undefined) {
  if (!close || close <= 0) return '—'
  if (close >= zone.lower_price && close <= zone.upper_price) return 'Trong vùng'
  // Choose the nearest boundary even when price has moved past a previous zone.
  const boundary = close < zone.lower_price ? zone.lower_price : zone.upper_price
  return `${number(Math.abs(close - boundary) / close * 100, 1)}% ${boundary < close ? 'dưới' : 'trên'}`
}

function ZoneMap({ zones, close, trend, timeframe, onDetails }: { zones: PriceZone[]; close: number | null | undefined; trend: string | undefined; timeframe: string; onDetails: OpenAnalysisDetails }) {
  const groups = (['RESISTANCE', 'SUPPORT'] as const).map(kind => ({ kind, title: kind === 'SUPPORT' ? 'Hỗ trợ' : 'Kháng cự', items: zones.filter(zone => zone.zone_type === kind).sort((a, b) => {
    const distance = (zone: PriceZone) => !close ? Infinity : close >= zone.lower_price && close <= zone.upper_price ? 0 : Math.min(Math.abs(close - zone.lower_price), Math.abs(close - zone.upper_price))
    return distance(a) - distance(b) || b.strength - a.strength
  }) }))
  const evidence = (zone: PriceZone) => <><dl className="quant-detail-facts"><div><dt>Vùng giá · VND/cổ phiếu</dt><dd>{formatMarketPrice(zone.lower_price)} – {formatMarketPrice(zone.upper_price)}</dd></div><div><dt>Khoảng cách</dt><dd>{zoneDistance(zone, close)}</dd></div><div><dt>Độ mạnh</dt><dd>{number(zone.strength, 0)}</dd></div><div><dt>Số lần chạm</dt><dd>{zone.touches}</dd></div><div><dt>Ngày dữ liệu</dt><dd>{displayDate(zone.as_of_date)}</dd></div></dl>{zone.evidence ? <ZoneEvidence zone={zone}/> : <p>Chưa có bằng chứng bổ sung cho vùng này.</p>}</>
  return <Card title="Hỗ trợ · kháng cự" subtitle={`${timeframe} · VND/cổ phiếu · ${zones.length} vùng`} onDetails={() => onDetails('Toàn bộ vùng giá và bằng chứng', <><p>{zoneContext[trend ?? 'UNKNOWN'] ?? zoneContext.UNKNOWN}</p>{groups.map(group => <section key={group.kind}><h3>{group.title} · {group.items.length} vùng</h3>{group.items.length ? group.items.map(zone => <article className="quant-zone-evidence" key={zone.id}>{evidence(zone)}</article>) : <p>Chưa có vùng đủ bằng chứng.</p>}</section>)}</>)}>
    {groups.map(group => <section className={`quant-zone-group ${group.kind.toLowerCase()}`} key={group.kind}><h4>{group.title}<span>{group.items.length} vùng</span></h4>{group.items.length ? <table className="quant-zone-table"><caption className="sr-only">Các vùng {group.title.toLowerCase()}</caption><thead><tr><th>Vùng giá</th><th>Cách giá</th><th>Độ mạnh</th><th>Chạm</th></tr></thead><tbody>{group.items.slice(0, 3).map(zone => <Fragment key={zone.id}><tr className="quant-zone-values"><td><button type="button" aria-label={`Xem bằng chứng ${group.title.toLowerCase()} ${formatMarketPrice(zone.lower_price)} đến ${formatMarketPrice(zone.upper_price)}`} onClick={() => onDetails(`${group.title} · khung ${timeframe}`, evidence(zone))}><span>{formatMarketPrice(zone.lower_price)}</span><span>– {formatMarketPrice(zone.upper_price)}</span></button></td><td>{zoneDistance(zone, close)}</td><td><span className="quant-zone-strength">{number(zone.strength, 0)}</span></td><td><span className="quant-zone-touches">{zone.touches}</span></td></tr><tr className="quant-zone-meta-row"><td colSpan={4}><small className="quant-zone-meta">Chạm {displayDate(zone.evidence?.last_touch_date)}{zone.evidence?.volume_ratio_at_touches != null ? ` · KL ${number(zone.evidence.volume_ratio_at_touches)}×` : ''}{zone.evidence?.reaction_pct != null ? ` · Phản ứng ${number(zone.evidence.reaction_pct, 0)}%` : ''}{zone.evidence?.fibonacci?.length ? ` · ${zone.evidence.fibonacci.length} hợp lưu Fib` : ''}</small></td></tr></Fragment>)}</tbody></table> : <p className="quant-empty">Chưa có vùng đủ pivot để xác nhận.</p>}</section>)}
  </Card>
}

function MonthlyCard({ value, onDetails }: { value?: MonthlyEvidence; onDetails: OpenAnalysisDetails }) {
  const state = value?.state ?? 'UNKNOWN'
  const pct = (n?: number) => n == null ? '—' : number(n * 100) + '%'
  return <Card title="Bối cảnh tháng" subtitle={`Tháng đã đóng · ${displayDate(value?.period_end)}`} action={<span className={`quant-status trend-${state.toLowerCase()}`}>{trendName[state] ?? trendName.UNKNOWN}</span>} onDetails={() => onDetails('Bối cảnh tháng', <MonthlyTrendEvidence value={value}/>)}>
    <dl className="quant-flow-grid"><div><dt>Close / EMA10</dt><dd>{formatMarketPrice(value?.close)} / {formatMarketPrice(value?.ema10)}</dd></div><div><dt>Độ dốc EMA10</dt><dd>{pct(value?.ema10_slope_3m)}</dd></div><div><dt>Trên / dưới EMA10</dt><dd>{value?.above_count ?? '—'} / {value?.below_count ?? '—'} tháng</dd></div><div><dt>Lịch sử</dt><dd>{value?.history_months ?? '—'} tháng</dd></div></dl>
    <p className="quant-caption">{value?.state_since ? 'Trạng thái từ ' + displayDate(value.state_since) : 'Chưa có mốc xác nhận'} · {value?.source_last_date ? 'Nến cuối ' + displayDate(value.source_last_date) : 'Chưa có nến tháng được công bố'}</p>
  </Card>
}

function FlowCard({ snapshot, timeframe }: { snapshot: TechnicalSnapshot | undefined; timeframe: 'D' | 'W' | 'M' }) {
  const state = snapshot?.flow_state ?? 'UNKNOWN'
  const title = ({ PURPLE:'Áp lực mua rất mạnh', GREEN:'Áp lực mua', BLUE:'Áp lực bán rất mạnh', RED:'Áp lực bán', NEUTRAL:'Cân bằng' } as Record<string, string>)[state] ?? 'Chưa đủ dữ liệu'
  const score = snapshot?.flow_score
  return <Card title="Áp lực giá–khối lượng" subtitle={`Prot Flow · ${timeframe} · ${displayDate(snapshot?.as_of_date)}`} action={<span className={`quant-status flow-${state.toLowerCase()}`}>{title}</span>}>
    <dl className="quant-flow-grid">{[['Điểm 20 nến', score == null ? '—' : `${score > 0 ? '+' : ''}${number(score, 1)}`], ['Bối cảnh', score == null ? 'Chưa đủ dữ liệu' : score > 0 ? 'Thiên tích lũy' : score < 0 ? 'Thiên phân phối' : 'Cân bằng'], ['CMF 20', number(snapshot?.cmf20, 3)], ['OBV', number(snapshot?.obv_slope20, 3)], ['KL/TB20', snapshot?.flow_volume_ratio20 == null ? '—' : `${number(snapshot.flow_volume_ratio20)}×`], ['CLV', number(snapshot?.flow_clv)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label === 'Điểm 20 nến' && score != null ? score < 0 ? 'negative' : 'positive' : undefined}>{value}</dd></div>)}</dl>
    <p className="quant-caption">Trạng thái phản ánh nến gần nhất</p>
  </Card>
}

function PatternPanel({ patterns, classical, asOf, timeframe, onDetails }: { patterns: PatternInstance[]; classical: ClassicalCandidate[]; asOf: string | undefined; timeframe: 'D' | 'W' | 'M'; onDetails: OpenAnalysisDetails }) {
  const nativeTypes = new Set(patterns.map(pattern => pattern.pattern_type))
  const active = [...patterns.map(pattern => ({ ...pattern, source:'Chart' })), ...classical.filter(pattern => !nativeTypes.has(pattern.pattern_type)).map((pattern, index) => ({ ...pattern, id:`core-${index}`, confirmed_at:null, source:'Core v0' }))].filter(pattern => ['FORMING', 'READY', 'CONFIRMED'].includes(pattern.state)).sort((a, b) => b.quality_score - a.quality_score)
  const stateLabel = (state: string) => state === 'CONFIRMED' ? 'Đã xác nhận' : state === 'READY' ? 'Chờ xác nhận' : 'Đang hình thành'
  const content = (pattern: typeof active[number]) => <><p>{pattern.source} · {stateLabel(pattern.state)} · Điểm cấu trúc {number(pattern.quality_score, 0)}</p><p>Ngưỡng {formatMarketPrice(pattern.trigger_price)} · Dữ liệu {displayDate(asOf)}{pattern.confirmed_at ? ` · Xác nhận ${displayDate(pattern.confirmed_at)}` : ''}</p><ul>{pattern.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></>
  return <Card title="Mẫu hình" subtitle={`${timeframe} · Nến đóng ${displayDate(asOf)} · ${active.length} cấu trúc`} onDetails={() => onDetails(`Toàn bộ ${active.length} mẫu hình`, <>{active.map(pattern => <section className="quant-zone-evidence" key={pattern.id}><h3>{patternNames[pattern.pattern_type] ?? pattern.pattern_type}</h3>{content(pattern)}</section>)}</>)}>
    <div className="quant-pattern-groups">{[{ label:'Cấu trúc tăng', direction:'BULLISH' }, { label:'Rủi ro giảm', direction:'BEARISH' }].map(group => { const items = active.filter(pattern => pattern.direction === group.direction); return <section key={group.direction}><h4>{group.label}</h4>{items.length ? items.slice(0, 3).map(pattern => <button type="button" className="quant-pattern-row" key={pattern.id} onClick={() => onDetails(patternNames[pattern.pattern_type] ?? pattern.pattern_type, content(pattern))}><span><strong>{patternNames[pattern.pattern_type] ?? pattern.pattern_type}</strong><small>{stateLabel(pattern.state)} · Ngưỡng {formatMarketPrice(pattern.trigger_price)}</small><small>{pattern.source} · {pattern.confirmed_at ? `Xác nhận ${displayDate(pattern.confirmed_at)}` : `Nến đóng ${displayDate(asOf)}`}</small></span><b>{number(pattern.quality_score, 0)}</b></button>) : <p className="quant-empty">Chưa có cấu trúc đủ bằng chứng.</p>}</section> })}</div>
    {active.some(pattern => pattern.direction === 'BULLISH') && active.some(pattern => pattern.direction === 'BEARISH') && <p className="quant-caption">Có kịch bản tăng và giảm đồng thời; chờ giá xác nhận hướng.</p>}
  </Card>
}

export function AnalysisPage({ authenticated }: { authenticated: boolean }) {
  const opportunityRoute = useOpportunityRoute()
  const symbols = useSymbols(authenticated)
  const [selected, setSelected] = useState<string | null>(() => opportunityRoute.symbol || localStorage.getItem('protstock-symbol'))
  const [favorites, setFavorites] = useState<string[]>(() => loadWatchlist().filter(isWatchActive).map(item => item.symbol))
  const [timeframe, setTimeframe] = useState<'D' | 'W' | 'M'>('D')
  const [range, setRange] = useState('1Y')
  const [multiPane, setMultiPane] = useState(() => localStorage.getItem('protstock-chart-mode') === 'triple')
  const [indicators, setIndicators] = useState({ ma20:true, ma50:true, ma200:false, bollinger:false, rsi:true, macd:false })
  const [detail, setDetail] = useState<AnalysisDetail | null>(null)
  const closeDetails = useCallback(() => setDetail(null), [])
  const openDetails: OpenAnalysisDetails = useCallback((title, content) => setDetail({ title, content }), [])
  useEffect(() => { if (!selected && symbols.data?.length) setSelected(symbols.data.find(item => item.symbol === 'FPT')?.symbol ?? symbols.data[0].symbol) }, [selected, symbols.data])
  useEffect(() => { const listener = (event: Event) => setSelected((event as CustomEvent).detail); const favoriteListener = (event: Event) => setFavorites((event as CustomEvent).detail); addEventListener('protstock:symbol', listener); addEventListener('protstock:favorites', favoriteListener); return () => { removeEventListener('protstock:symbol', listener); removeEventListener('protstock:favorites', favoriteListener) } }, [])
  useEffect(() => { if (opportunityRoute.symbol) setSelected(opportunityRoute.symbol) }, [opportunityRoute.symbol])
  useEffect(closeDetails, [selected, timeframe, opportunityRoute.date, closeDetails])
  const dailyAnalysis = useStockAnalysis(selected, 'D', authenticated, opportunityRoute.date)
  const weeklyAnalysis = useStockAnalysis(selected, 'W', authenticated, opportunityRoute.date)
  const monthlyAnalysis = useStockAnalysis(selected, 'M', authenticated, opportunityRoute.date)
  const analysis = { D:dailyAnalysis, W:weeklyAnalysis, M:monthlyAnalysis }[timeframe]
  const snapshot = analysis.data?.technical[0]
  const bars = useMemo(() => analysis.data?.prices.slice(-rangeSize[range]) ?? [], [analysis.data?.prices, range])
  const closedBars = analysis.data?.prices.filter(bar => bar.is_complete !== false) ?? []
  const changePct = closedBars.length >= 2 ? (closedBars[closedBars.length - 1].close - closedBars[closedBars.length - 2].close) / closedBars[closedBars.length - 2].close * 100 : null
  const formingBar = timeframe !== 'D' && bars.at(-1)?.is_complete === false ? bars.at(-1) : null
  const chipValue: Record<string, number | null | undefined> = { ma20:snapshot?.sma20, ma50:snapshot?.sma50, ma200:snapshot?.sma200, rsi:snapshot?.rsi14, macd:snapshot?.macd }
  return <section className="workspace-page quant-analysis">
    <header className="page-title-row quant-page-header"><h1>Phân tích mã</h1><ExRightsCalculator symbols={symbols.data ?? []} selected={selected}/></header>
    {opportunityRoute.date && <p className="quant-caption">Đang xem phiên {displayDate(opportunityRoute.date)} · <a href="#analysis" onClick={() => { if (selected) localStorage.setItem('protstock-symbol', selected) }}>Về dữ liệu mới nhất</a></p>}
    {analysis.isLoading && <div className="skeleton-page"><div className="skeleton skeleton-card"/></div>}
    {analysis.isError && <div className="empty-state warning">Chưa tải được dữ liệu phân tích. <button className="text-button" onClick={() => void analysis.refetch()}>Thử lại</button></div>}
    {!authenticated && !analysis.data && <div className="empty-state"><Search size={24}/><p>Kết nối dữ liệu để xem biểu đồ và phân tích.</p></div>}
    {analysis.data && <>
      <div className="quant-workspace">
        <aside className="quant-profile" aria-label="Hồ sơ và chỉ số doanh nghiệp">
      <div className="quant-instrument"><div className="quant-instrument-name"><button type="button" className="quant-symbol" aria-label={`Đổi mã, hiện tại ${analysis.data.symbol.symbol}`} onClick={() => openCommandPalette('symbols')}>{analysis.data.symbol.symbol}</button><button type="button" className="quant-watch" aria-label={`${favorites.includes(selected ?? '') ? 'Bỏ' : 'Thêm'} ${selected} ${favorites.includes(selected ?? '') ? 'khỏi' : 'vào'} Watchlist`} aria-pressed={favorites.includes(selected ?? '')} onClick={() => { if (selected) toggleWatchlistSymbol(selected) }}><Star size={15} fill={favorites.includes(selected ?? '') ? 'currentColor' : 'none'}/></button><span>{analysis.data.symbol.company_name || 'Chưa đồng bộ tên doanh nghiệp'}</span></div><p>{exchangeLabel(analysis.data.symbol.exchange)} · {analysis.data.symbol.sector} · {displayDate(snapshot?.as_of_date)}<span className={`quant-status trend-${(snapshot?.trend_state ?? 'UNKNOWN').toLowerCase()}`}>{trendName[snapshot?.trend_state ?? 'UNKNOWN'] ?? trendName.UNKNOWN}</span></p></div>
      <dl className="panel quant-quote-strip" aria-label="Số liệu phiên đã đóng"><div><dt>Đóng cửa</dt><dd>{formatMarketPrice(snapshot?.close)}</dd></div><div><dt>Thay đổi phiên</dt><dd className={changePct == null ? '' : changePct < 0 ? 'negative' : 'positive'}>{changePct == null ? '—' : `${changePct >= 0 ? '+' : ''}${number(changePct)}%`}</dd></div><div><dt>ATR 14</dt><dd>{formatMarketPrice(snapshot?.atr14)}</dd></div><div><dt>Volume/TB20</dt><dd>{snapshot?.volume_ratio20 == null ? '—' : `${number(snapshot.volume_ratio20)}×`}</dd></div></dl>

          <VciCompanyCard symbolId={analysis.data.symbol.id} historical={Boolean(opportunityRoute.date)}/>
          <MonthlyCard value={snapshot?.monthly_context} onDetails={openDetails}/>
        </aside>
        <div className="quant-main">
          <section className="panel quant-chart-panel" aria-label="Biểu đồ giá và công cụ">
            <div className="quant-chart-toolbar"><div className="quant-control-group" aria-label="Khoảng thời gian">{['1M','3M','6M','1Y','3Y','ALL'].map(item => <button type="button" aria-pressed={range === item} onClick={() => setRange(item)} key={item}>{item === 'ALL' ? 'Tất cả' : item}</button>)}</div><div className="quant-control-group" aria-label="Khung nến">{([['D','Ngày'],['W','Tuần'],['M','Tháng']] as const).map(([value, label]) => <button type="button" aria-pressed={timeframe === value && !multiPane} onClick={() => { setTimeframe(value); setMultiPane(false); localStorage.setItem('protstock-chart-mode','single') }} key={value}>{label}</button>)}<button type="button" aria-pressed={multiPane} onClick={() => setMultiPane(current => { localStorage.setItem('protstock-chart-mode', current ? 'single' : 'triple'); return !current })}>M/W/D</button></div></div>
            <div className="quant-control-group quant-indicators" aria-label="Chỉ báo">{([['ma20','MA20'],['ma50','MA50'],['ma200','MA200'],['bollinger','Bollinger'],['rsi','RSI'],['macd','MACD']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={indicators[key]} onClick={() => setIndicators(current => ({ ...current, [key]:!current[key] }))}>{label}{indicators[key] && chipValue[key] != null && <b>{key === 'rsi' ? number(chipValue[key]) : formatMarketPrice(chipValue[key])}</b>}</button>)}</div>
            {multiPane ? <div className="quant-multi-charts">{([['M','Tháng'],['W','Tuần'],['D','Ngày']] as const).map(([pane, label]) => { const data = { D:dailyAnalysis, W:weeklyAnalysis, M:monthlyAnalysis }[pane].data; const paneBars = data?.prices.slice(-(pane === 'M' ? 60 : pane === 'W' ? 156 : 260)) ?? []; return <article className="multi-chart-pane" key={pane}><h4>Khung {label}</h4>{paneBars.length ? <StockChart bars={paneBars} zones={data?.zones} patterns={data?.patterns} indicators={indicators} paneId={pane} paneLabel={`Khung ${label}`}/> : <p className="quant-empty">Chưa có dữ liệu {label.toLowerCase()}.</p>}</article> })}</div> : bars.length ? <StockChart bars={bars} zones={analysis.data.zones} patterns={analysis.data.patterns} indicators={indicators} paneId={timeframe} paneLabel={`Khung ${timeframe}`}/> : <p className="quant-empty">Chưa có OHLCV cho phiên được chọn.</p>}
            {indicators.macd && <MacdPanel bars={dailyAnalysis.data?.prices ?? []}/>}
            {formingBar && <p className="quant-caption">Nến {timeframe === 'W' ? 'tuần' : 'tháng'} đến {displayDate(formingBar.trading_date)} đang hình thành. Kết luận dùng nến đã đóng đến {displayDate(snapshot?.as_of_date)}.</p>}
            {dailyAnalysis.data?.prices.at(-1)?.source && <p className="quant-caption">OHLCV EOD · {dailyAnalysis.data.prices.at(-1)?.source} · Giá và khối lượng theo chuỗi do nguồn cung cấp.</p>}
          </section>
          <FlowCard snapshot={snapshot} timeframe={timeframe}/>
          <div className="quant-evidence-grid"><PatternPanel patterns={analysis.data.patterns} classical={snapshot?.classical_candidates ?? []} asOf={snapshot?.as_of_date} timeframe={timeframe} onDetails={openDetails}/></div>

        </div>
        <aside className="quant-side" aria-label="Kết luận và vùng giá"><DecisionCard decision={analysis.data.decision} snapshot={snapshot} timeframe={timeframe} onDetails={openDetails}/><OpportunityAnalysis symbol={analysis.data.symbol.symbol} onOpenDetails={openDetails}/><ZoneMap zones={analysis.data.zones} close={snapshot?.close} trend={snapshot?.trend_state} timeframe={timeframe} onDetails={openDetails}/></aside>
      </div>
    </>}
    <AnalysisDetails detail={detail} onClose={closeDetails}/>
  </section>
}
