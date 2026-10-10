import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { isCurrentMacdLink, matchesRadarStage, radarMilestonesToday, radarOpportunityPriority } from '../lib/radarOverview'
import { ResearchPagination } from './ResearchPagination'
import { SoftSelect } from './SoftSelect'
import './MomentumRadarPanel.css'

type Milestone = { date: string; kind: string; close: number; level?: number; volume_ratio_20?: number; weekly_volume_ratio_13?: number }
type Evidence = { close?: number; volume_ratio_20?: number; daily_return_pct?: number; monthly_state?: string;
  distance_to_stop_pct?: number | null; milestones?: Milestone[] }
type RadarRow = { symbol_id: number; symbol: string; as_of_date: string; event_start_date: string | null;
  breakout_date: string | null; weekly_confirmed_date: string | null; reacceleration_date: string | null;
  breakout_level: number | null; structural_stop: number | null; stage: string; entry_status: string; evidence: Evidence }
type FunnelRow = { symbol_id: number; stage: string; setup_kind: string | null; setup_date: string | null; trigger_date: string | null }
type MacdRow = { symbol_id: number; stage: string; confirmed_on: string; trigger_date: string | null; swings: number;
  evidence: { trigger_age_sessions?: number | null } | null }
type AdaptiveRow = { symbol_id: number; action: string; evidence: { funnel_stage?: string; weekly_setup?: string | null } | null }
export type RadarChampionSignal = { symbol_id: number; action: string; timeframe: string; as_of_date: string }
export type RadarDestination = 'watch' | 'funnel' | 'macd' | 'analysis'

const stageNames: Record<string, string> = {
  DAILY_BREAKOUT: 'Breakout ngày', WEEKLY_CONFIRMED: 'Tuần xác nhận', REACCELERATING: 'Tăng tốc lại',
  SURGE_WATCH: 'Đột biến sớm', CONTINUING: 'Đang tiếp diễn', INVALIDATED: 'Mất hiệu lực',
  DATA_CHECK: 'Cần kiểm tra dữ liệu', NO_EVENT: 'Chưa có sự kiện', WEEKLY_CONTINUATION: 'Tuần tiếp diễn',
}
const setupNames: Record<string, string> = {
  WEEKLY_BREAKOUT_13: 'Breakout 13 tuần', WEEKLY_PULLBACK_EMA20: 'Hồi EMA20 tuần', WEEKLY_RANGE_SUPPORT: 'Hồi hỗ trợ tuần',
}
const stageOrder = ['ALL', 'DAILY_BREAKOUT', 'WEEKLY_CONFIRMED', 'REACCELERATING',
  'SURGE_WATCH', 'CONTINUING', 'INVALIDATED', 'DATA_CHECK', 'NO_EVENT'] as const
const activeStages = new Set(['SURGE_WATCH', 'DAILY_BREAKOUT', 'WEEKLY_CONFIRMED', 'CONTINUING', 'REACCELERATING'])
const day = (value: string | null | undefined) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : '—'
const fullDay = (value: string | null | undefined) => value ? `${day(value)}/${value.slice(0, 4)}` : '—'
const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits })
const isBuy = (action: string) => action === 'PROBE_BUY' || action === 'ADD'
const macdText = (row: MacdRow) => row.stage === 'CONFIRMED' ? `Xác nhận ${fullDay(row.trigger_date)}`
  : row.stage === 'WATCH_PRICE_CONFIRMATION' ? 'Chờ giá xác nhận'
  : row.stage === 'INVALIDATED' ? 'Đã vô hiệu' : row.stage === 'EXPIRED' ? 'Đã hết hạn' : row.stage
const macdPriority = (row: MacdRow, date: string) => row.stage === 'CONFIRMED' && row.trigger_date === date ? 0
  : row.stage === 'WATCH_PRICE_CONFIRMATION' ? 1 : row.stage === 'CONFIRMED' ? 2 : 3

function riskText(row: RadarRow) {
  if (row.entry_status === 'EXTENDED') return `Quá xa stop ${number(row.evidence?.distance_to_stop_pct)}%`
  if (row.entry_status === 'RISK_WINDOW') return `Khoảng cách stop ${number(row.evidence?.distance_to_stop_pct)}% · đạt sơ bộ`
  if (row.entry_status === 'DATA_CHECK') return 'Cần kiểm tra giá'
  return row.stage === 'NO_EVENT' ? 'Chưa có stop Radar' : 'Chưa có điểm vào Radar'
}

function nextStep(row: RadarRow, funnel?: FunnelRow, macd?: MacdRow) {
  if (row.entry_status === 'EXTENDED') return 'Chờ vùng rủi ro phù hợp hơn'
  if (funnel?.stage === 'WEEKLY_READY') return 'Chờ trigger ngày của Phễu'
  if (macd?.stage === 'WATCH_PRICE_CONFIRMATION') return 'Chờ giá xác nhận phân kỳ'
  if (row.stage === 'SURGE_WATCH') return 'Chờ breakout và xác nhận tuần'
  if (activeStages.has(row.stage)) return 'Theo dõi cấu trúc và stop'
  return 'Chưa có mốc tiếp theo'
}

export function MomentumRadarPanel({ date, championSignals, championLoading, championError, onNavigate }: {
  date: string; championSignals: RadarChampionSignal[]; championLoading: boolean; championError: boolean;
  onNavigate: (target: RadarDestination, symbol: string, engine?: 'champion' | 'challenger') => void
}) {
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('ALL')
  const [risk, setRisk] = useState('ALL')
  const [source, setSource] = useState('ALL')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const radar = useQuery({ queryKey: ['momentum-radar', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async (): Promise<RadarRow[]> => {
    const rows: RadarRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('momentum_radar_assessments')
        .select('symbol_id,as_of_date,event_start_date,breakout_date,weekly_confirmed_date,reacceleration_date,breakout_level,structural_stop,stage,entry_status,evidence,symbols!inner(symbol)')
        .eq('as_of_date', date).eq('version', 'MOMENTUM_RADAR_V1').order('symbol_id').range(from, from + 999)
      if (error) throw error
      rows.push(...(data ?? []).map((item: any) => ({ ...item,
        symbol: (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol ?? `#${item.symbol_id}` })))
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })
  const funnel = useQuery({ queryKey: ['radar-funnel-links', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async (): Promise<FunnelRow[]> => {
    const rows: FunnelRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('signal_funnel_assessments')
        .select('symbol_id,stage,setup_kind,setup_date,trigger_date')
        .eq('as_of_date', date).eq('version', 'MTF_FUNNEL_SHADOW_V2').order('symbol_id').range(from, from + 999)
      if (error) throw error
      rows.push(...(data ?? []) as FunnelRow[])
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })
  const macd = useQuery({ queryKey: ['radar-macd-links', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async (): Promise<MacdRow[]> => {
    const rows: MacdRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('macd_divergence_assessments')
        .select('symbol_id,stage,confirmed_on,trigger_date,swings,evidence')
        .eq('as_of_date', date).eq('version', 'MACD_BULLISH_DIVERGENCE_ZONE_V4').eq('oscillator', 'MACD_LINE')
        .order('symbol_id').range(from, from + 999)
      if (error) throw error
      rows.push(...(data ?? []) as MacdRow[])
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })
  const adaptive = useQuery({ queryKey: ['radar-adaptive-links', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async (): Promise<AdaptiveRow[]> => {
    const rows: AdaptiveRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('challenger_strategy_assessments')
        .select('symbol_id,action,evidence').eq('trading_date', date).eq('engine_version', 'v2.0-challenger')
        .eq('strategy_code', 'ADAPTIVE_FUNNEL').order('symbol_id').range(from, from + 999)
      if (error) throw error
      rows.push(...(data ?? []) as AdaptiveRow[])
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })

  const funnelById = useMemo(() => new Map((funnel.data ?? []).map(item => [item.symbol_id, item])), [funnel.data])
  const macdById = useMemo(() => {
    const map = new Map<number, MacdRow>()
    for (const item of macd.data ?? []) {
      if (!isCurrentMacdLink(item, date)) continue
      const old = map.get(item.symbol_id)
      if (!old || macdPriority(item, date) < macdPriority(old, date)) map.set(item.symbol_id, item)
    }
    return map
  }, [macd.data, date])
  const adaptiveById = useMemo(() => new Map((adaptive.data ?? []).map(item => [item.symbol_id, item])), [adaptive.data])
  const championsById = useMemo(() => {
    const map = new Map<number, RadarChampionSignal[]>()
    for (const item of championSignals.filter(item => item.as_of_date === date)) map.set(item.symbol_id, [...(map.get(item.symbol_id) ?? []), item])
    return map
  }, [championSignals, date])
  const all = radar.data ?? []
  const counts = useMemo(() => ({ active: all.filter(item => activeStages.has(item.stage)).length,
    fresh: all.filter(item => radarMilestonesToday(item).length).length,
    extended: all.filter(item => item.entry_status === 'EXTENDED').length }), [all])
  const rows = all.filter(item => {
    const relatedFunnel = funnelById.get(item.symbol_id)
    const relatedMacd = macdById.get(item.symbol_id)
    const relatedAdaptive = adaptiveById.get(item.symbol_id)
    return item.symbol.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))
      && matchesRadarStage(item, stage)
      && (risk === 'ALL' || risk === 'NEW' && radarMilestonesToday(item).length > 0
        || risk === 'RISK_WINDOW' && item.entry_status === 'RISK_WINDOW'
        || risk === 'EXTENDED' && item.entry_status === 'EXTENDED')
      && (source === 'ALL' || source === 'CHAMPION' && Boolean(championsById.get(item.symbol_id)?.length)
        || source === 'FUNNEL' && Boolean(relatedFunnel?.setup_kind)
        || source === 'ADAPTIVE' && Boolean(relatedAdaptive?.evidence?.weekly_setup)
        || source === 'MACD' && Boolean(relatedMacd))
  }).sort((a, b) => radarOpportunityPriority(a, championsById.get(a.symbol_id) ?? [], funnelById.get(a.symbol_id), macdById.get(a.symbol_id))
    - radarOpportunityPriority(b, championsById.get(b.symbol_id) ?? [], funnelById.get(b.symbol_id), macdById.get(b.symbol_id))
    || (b.evidence?.volume_ratio_20 ?? 0) - (a.evidence?.volume_ratio_20 ?? 0) || a.symbol.localeCompare(b.symbol))
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)

  return <article className="panel momentum-radar-panel" id="screener-panel-radar" role="tabpanel" aria-labelledby="screener-tab-radar">
    <div className="panel-title"><div><h3>Radar cơ hội</h3><p className="muted">Một mã · một diễn biến · đối chiếu Phễu, WATCH và phân kỳ cùng phiên.</p></div><time>{day(date)}/{date.slice(0, 4)}</time></div>
    <div className="radar-summary"><span><b>{all.length}</b> mã</span><span><b>{counts.active}</b> đang có đà</span><span><b>{counts.fresh}</b> có mốc mới</span><span><b>{counts.extended}</b> quá xa stop</span></div>
    <div className="radar-filters"><label className="radar-search">Tìm mã <span className="radar-search-control"><Search size={15}/><input aria-label="Tìm mã Radar" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Tìm mã…"/></span></label>
      <label>Giai đoạn <SoftSelect aria-label="Lọc giai đoạn Radar" value={stage} onChange={event => { setStage(event.target.value); setPage(1) }}>{stageOrder.map(value => <option key={value} value={value}>{value === 'ALL' ? 'Tất cả' : stageNames[value]}</option>)}</SoftSelect></label>
      <label>Điểm vào <SoftSelect aria-label="Lọc rủi ro Radar" value={risk} onChange={event => { setRisk(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option><option value="NEW">Mốc mới phiên này</option><option value="RISK_WINDOW">Khoảng cách stop đạt sơ bộ</option><option value="EXTENDED">Quá xa stop</option></SoftSelect></label>
      <label>Nguồn <SoftSelect aria-label="Lọc nguồn bằng chứng" value={source} onChange={event => { setSource(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option><option value="CHAMPION">Champion / WATCH</option><option value="FUNNEL">Phễu gốc</option><option value="ADAPTIVE">Phễu Challenger</option><option value="MACD">Phân kỳ MACD</option></SoftSelect></label>
      <span>{rows.length} mã · trang {current}/{pages}</span></div>
    <p className="radar-help">Ưu tiên tín hiệu Champion đã công bố và mốc mới có khoảng cách stop phù hợp. Radar giúp tìm mã theo dữ liệu cuối phiên; khối lượng khớp lệnh không phải tiền mua ròng.</p>
    {radar.isLoading && <p>Đang tải Radar…</p>}
    {radar.isError && <p className="form-error" role="alert">Không tải được Radar. <button className="text-button" onClick={() => void radar.refetch()}>Thử lại</button></p>}
    {(funnel.isError || macd.isError || adaptive.isError) && <p className="muted" role="status">Một nguồn đối chiếu chưa tải được; nhãn liên quan sẽ ghi rõ “Chưa tải được”.</p>}
    {!radar.isLoading && !radar.isError && <><div className="radar-list">{rows.slice((current - 1) * pageSize, current * pageSize).map(row => {
      const linkedFunnel = funnelById.get(row.symbol_id)
      const linkedMacd = macdById.get(row.symbol_id)
      const linkedAdaptive = adaptiveById.get(row.symbol_id)
      const champion = championsById.get(row.symbol_id) ?? []
      const fresh = radarMilestonesToday(row)
      const headline = fresh.length ? fresh.map(item => stageNames[item.kind] ?? item.kind).join(' · ')
        : row.stage === 'NO_EVENT' && linkedFunnel?.stage === 'WEEKLY_READY' ? 'Setup Phễu chờ kích hoạt'
        : stageNames[row.stage] ?? row.stage
      return <section className={`radar-item ${row.entry_status === 'EXTENDED' ? 'radar-item-extended' : ''}`} key={row.symbol_id}>
        <div className="radar-line"><button className="radar-expand" type="button" aria-label={`${expanded===row.symbol_id?'Thu gọn':'Xem chi tiết'} ${row.symbol}`} aria-expanded={expanded===row.symbol_id} onClick={() => setExpanded(value => value === row.symbol_id ? null : row.symbol_id)}><ChevronDown size={16}/></button>
          <div className="radar-symbol"><strong>{row.symbol}</strong><small>{row.evidence?.monthly_state ? `Tháng ${row.evidence.monthly_state}` : 'Tháng chưa rõ'}</small></div>
          <div className="radar-current"><b>{headline}</b><small>{fresh.length ? `Mới ${day(date)}` : `Phát hiện từ ${day(row.event_start_date)}`}</small></div>
          <div className="radar-evidence">
            {champion.some(item => isBuy(item.action)) && <span className="radar-tag buy">Champion {champion.find(item => isBuy(item.action))?.action}</span>}
            {champion.some(item => item.action === 'WATCH') && <span className="radar-tag">WATCH</span>}
            {linkedFunnel?.setup_kind && <span className="radar-tag">Phễu {linkedFunnel.stage === 'DAILY_TRIGGER' ? 'trigger mới' : linkedFunnel.stage === 'TRIGGERED_EARLIER' ? `trigger ${day(linkedFunnel.trigger_date)}` : 'setup tuần'}</span>}
            {linkedAdaptive?.evidence?.weekly_setup && <span className="radar-tag">Challenger {setupNames[linkedAdaptive.evidence.weekly_setup] ?? linkedAdaptive.evidence.weekly_setup}</span>}
            {linkedMacd && <span className="radar-tag">MACD {macdText(linkedMacd)}</span>}
            {!champion.length && !linkedFunnel?.setup_kind && !linkedAdaptive?.evidence?.weekly_setup && !linkedMacd && <span className="radar-tag quiet">{championLoading || funnel.isLoading || macd.isLoading || adaptive.isLoading ? 'Đang đối chiếu nguồn…' : championError || funnel.isError || macd.isError || adaptive.isError ? 'Nguồn đối chiếu chưa tải đủ' : 'Chưa có bằng chứng liên quan'}</span>}
          </div>
          <div className={`radar-risk ${row.entry_status === 'EXTENDED' ? 'is-extended' : row.entry_status === 'RISK_WINDOW' ? 'is-ready' : ''}`}><b>{riskText(row)}</b><small>{nextStep(row, linkedFunnel, linkedMacd)}</small></div>
        </div>
        {expanded===row.symbol_id && <div className="radar-detail">
          <div className="radar-detail-top"><div><strong>Diễn biến của {row.symbol}</strong><p>Close {number(row.evidence?.close)} · Biến động ngày {number(row.evidence?.daily_return_pct)}% · Volume {number(row.evidence?.volume_ratio_20)}× TB20</p><p>Breakout {day(row.breakout_date)} tại {number(row.breakout_level)} · Stop cấu trúc {number(row.structural_stop)} · Xác nhận tuần {day(row.weekly_confirmed_date)}</p></div><button type="button" className="secondary-button" onClick={() => onNavigate('analysis', row.symbol)}>Xem biểu đồ <ArrowUpRight size={14}/></button></div>
          <div className="radar-source-grid"><div><strong>Champion / WATCH</strong><p>{championLoading ? 'Đang tải…' : championError ? 'Chưa tải được' : champion.length ? [...new Set(champion.map(item => `${item.action} · ${item.timeframe}`))].join(' · ') : 'Không có tín hiệu công bố trong phiên'}</p><button type="button" onClick={() => onNavigate('watch', row.symbol, 'champion')}>Mở WATCH <ArrowUpRight size={13}/></button></div>
            <div><strong>Phễu gốc</strong><p>{funnel.isLoading ? 'Đang tải…' : funnel.isError ? 'Chưa tải được' : !linkedFunnel ? 'Chưa có đánh giá phiên này' : linkedFunnel.setup_kind ? `${setupNames[linkedFunnel.setup_kind] ?? linkedFunnel.setup_kind} · ${linkedFunnel.stage === 'DAILY_TRIGGER' ? 'trigger mới' : linkedFunnel.stage === 'TRIGGERED_EARLIER' ? `trigger ${day(linkedFunnel.trigger_date)}` : 'chờ trigger'}` : 'Chưa có setup tuần trong phiên'}</p><button type="button" onClick={() => onNavigate('funnel', row.symbol, 'champion')}>Mở Phễu <ArrowUpRight size={13}/></button></div>
            <div><strong>Phễu Challenger</strong><p>{adaptive.isError ? 'Chưa tải được' : linkedAdaptive?.evidence?.weekly_setup ? `${setupNames[linkedAdaptive.evidence.weekly_setup] ?? linkedAdaptive.evidence.weekly_setup} · ${linkedAdaptive.action}` : 'Chưa có setup thích ứng trong phiên'}</p><button type="button" onClick={() => onNavigate('funnel', row.symbol, 'challenger')}>Mở Challenger <ArrowUpRight size={13}/></button></div>
            <div><strong>Phân kỳ MACD</strong><p>{macd.isLoading ? 'Đang tải…' : macd.isError ? 'Chưa tải được' : linkedMacd ? `${macdText(linkedMacd)} · ${linkedMacd.swings} vùng đáy` : 'Chưa có mẫu trong phiên'}</p><button type="button" onClick={() => onNavigate('macd', row.symbol, 'champion')}>Mở phân kỳ <ArrowUpRight size={13}/></button></div></div>
          {!!row.evidence?.milestones?.length && <div className="radar-timeline"><strong>Các mốc của đợt tăng</strong><ol>{row.evidence.milestones.map((item, index) => <li key={`${item.date}-${item.kind}-${index}`}><time>{day(item.date)}</time><b>{stageNames[item.kind] ?? item.kind}</b><span>Close {number(item.close)}{item.volume_ratio_20 != null ? ` · Volume ${number(item.volume_ratio_20)}×` : ''}{item.level != null ? ` · Ngưỡng ${number(item.level)}` : ''}</span></li>)}</ol></div>}
        </div>}
      </section>
    })}</div>
      {!rows.length && <p className="muted">{all.length ? 'Không có mã khớp bộ lọc.' : `Phiên ${day(date)} chưa có dữ liệu Radar.`}</p>}
      <ResearchPagination label="Phân trang Radar cơ hội" page={current} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }}/>
    </>}
  </article>
}
