import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Search } from 'lucide-react'
import { useSymbols } from '../hooks/useStockAnalysis'
import { formatDate } from '../lib/date'
import { latestSignalPublication } from '../lib/signalPublication'
import { relativeSectorTurnover, sectorEligible, sectorHistory, sectorValue, SECTOR_PERIODS, type BreadthRow, type SectorPeriod, type SectorRow, type SectorView } from '../lib/sectorHistory'
import { supabase } from '../lib/supabase'
import '../market-page.css'

type Membership = { symbol_id: number; status: string }

const pct = (value: number | null | undefined) => value == null ? '—' : `${Number(value).toFixed(1)}%`
const score = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(1)
const stateLabel = (state?: string) => state === 'RISK_ON' ? 'Tích cực' : state === 'RISK_OFF' ? 'Phòng thủ' : state === 'NEUTRAL' ? 'Trung tính' : 'Chưa đủ dữ liệu'
const sectorName = (value: string | null | undefined) => value?.trim() || 'Chưa phân ngành'
const sectorLink = (sector: string) => `#universe?sector=${encodeURIComponent(sector)}`
const signed = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`
const rankMove = (value: number | null) => value == null ? '—' : value > 0 ? `↑${value}` : value < 0 ? `↓${Math.abs(value)}` : '—'

function SectorTrend({ observations, view, sector }: { observations: { date: string; value: number }[]; view: SectorView; sector: string }) {
  if (observations.length < 2) return <p className="market-empty">Chưa đủ phiên hợp lệ để vẽ xu hướng ngành này.</p>
  const samples = observations.length > 70
    ? observations.filter((_, index) => index % Math.ceil(observations.length / 60) === 0 || index === observations.length - 1)
    : observations
  const y = (value: number) => 116 - (view === 'health' ? value / 100 : (value + 100) / 200) * 100
  const points = samples.map((item, index) => `${24 + index * 552 / (samples.length - 1)},${y(item.value)}`).join(' ')
  return <div className="market-trend-chart"><svg viewBox="0 0 600 140" preserveAspectRatio="none" role="img" aria-label={`Xu hướng ${view === 'health' ? 'Sức khỏe' : 'Sector Flow'} của ngành ${sector} từ ${formatDate(observations[0].date)} đến ${formatDate(observations.at(-1)?.date)}`}>
    <line x1="24" y1="16" x2="576" y2="16" className="market-chart-grid"/><line x1="24" y1="66" x2="576" y2="66" className="market-chart-grid"/><line x1="24" y1="116" x2="576" y2="116" className="market-chart-grid"/>
    <polyline points={points} className={view === 'health' ? 'market-chart-health' : 'market-chart-flow'}/>
  </svg><div><span>{formatDate(observations[0].date)}</span><span>{formatDate(observations.at(-1)?.date)}</span></div></div>
}

export function MarketPage({ authenticated }: { authenticated: boolean }) {
  const symbols = useSymbols(authenticated)
  const [selectedDate, setSelectedDate] = useState('')
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<SectorView>('health')
  const [period, setPeriod] = useState<SectorPeriod>('month')
  const [selectedSector, setSelectedSector] = useState('')
  const [showMethod, setShowMethod] = useState(false)
  const market = useQuery({
    queryKey: ['market-statistics-history'], enabled: authenticated && Boolean(supabase), staleTime: 60_000, refetchInterval: 60_000,
    queryFn: async () => {
      const publication = await latestSignalPublication()
      if (!publication) return { publication: null, dates: [] as string[] }
      const { data, error } = await supabase!.from('market_breadth_snapshots')
        .select('trading_date').lte('trading_date', publication.date)
        .order('trading_date', { ascending: false }).limit(400)
      if (error) throw error
      return { publication, dates: (data ?? []).map(row => row.trading_date) }
    },
  })
  const day = selectedDate || market.data?.publication?.date || ''
  const history = useQuery({
    queryKey: ['sector-history', day, period], enabled: authenticated && Boolean(supabase) && Boolean(day), staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('market_breadth_snapshots')
        .select('trading_date,universe_size,observed_count,eligible_count,coverage_ratio,coverage_status,market_health_score,market_health_state,sector_breadth')
        .lte('trading_date', day).order('trading_date', { ascending: false })
        .limit(Math.max(SECTOR_PERIODS[period].sessions, 21))
      if (error) throw error
      return (data ?? []) as BreadthRow[]
    },
  })
  const breadth = history.data?.[0]?.trading_date === day ? history.data[0] : undefined
  const periodRows = useMemo(() => history.data?.slice(0, SECTOR_PERIODS[period].sessions) ?? [], [history.data, period])
  const memberships = useQuery({
    queryKey: ['market-universe-membership', day], enabled: authenticated && Boolean(supabase) && Boolean(day), staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('breadth_universe_memberships').select('symbol_id,status').eq('trading_date', day)
      if (error) throw error
      return (data ?? []) as Membership[]
    },
  })
  const universe = symbols.data ?? []
  const sectorCounts = useMemo(() => {
    const result = new Map<string, number>()
    universe.forEach(item => result.set(sectorName(item.sector), (result.get(sectorName(item.sector)) ?? 0) + 1))
    return result
  }, [universe])
  const exchangeCounts = useMemo(() => {
    const result = new Map<string, number>()
    universe.forEach(item => { const exchange = item.exchange || 'Chưa xác định'; result.set(exchange, (result.get(exchange) ?? 0) + 1) })
    return [...result].sort((a, b) => b[1] - a[1])
  }, [universe])
  const rows = useMemo(() => {
    const recorded = breadth?.sector_breadth ?? []
    const recordedNames = new Set(recorded.map(item => item.sector))
    const all = [...recorded, ...[...sectorCounts].filter(([sector]) => !recordedNames.has(sector)).map(([sector, total]) => ({ sector, sample_size: 0, universe_count: total } as SectorRow))]
    return all.map(item => {
    const total = item.universe_count ?? sectorCounts.get(item.sector) ?? item.sample_size
    const coverage = item.coverage_ratio ?? (total ? item.sample_size / total : 0)
    const healthQualified = breadth ? sectorEligible(breadth, item, 'health') : false
    const flowQualified = breadth ? sectorEligible(breadth, item, 'flow') : false
    const healthHistory = sectorHistory(periodRows, item.sector, 'health', SECTOR_PERIODS[period].sessions)
    const flowHistory = sectorHistory(periodRows, item.sector, 'flow', SECTOR_PERIODS[period].sessions)
    return { ...item, total, coverage, healthQualified, flowQualified, healthHistory, flowHistory,
      relativeTurnover: relativeSectorTurnover(history.data ?? [], item.sector) }
    })
  }, [breadth, sectorCounts, history.data, period, periodRows])
  const visible = rows.filter(row => row.sector.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')))
    .sort((a, b) => section === 'health'
      ? Number(b.healthQualified && b.healthHistory.complete) - Number(a.healthQualified && a.healthHistory.complete) || Number(b.market_health_score ?? -1) - Number(a.market_health_score ?? -1)
      : Number(b.flowQualified && b.flowHistory.complete) - Number(a.flowQualified && a.flowHistory.complete) || Number(b.flow_median_score ?? -101) - Number(a.flow_median_score ?? -101))
  const focused = visible.find(row => row.sector === selectedSector) ?? visible.find(row => section === 'health' ? row.healthQualified : row.flowQualified) ?? visible[0]
  const focusedHistory = focused ? section === 'health' ? focused.healthHistory : focused.flowHistory : null
  const missing = memberships.data?.filter(item => item.status === 'DATA_MISSING_OR_HALTED' || item.status === 'NOT_ELIGIBLE').length ?? Math.max(0, universe.length - (breadth?.observed_count ?? 0))
  const insufficient = memberships.data?.filter(item => item.status === 'INSUFFICIENT_HISTORY').length ?? 0

  return <section className="workspace-page market-page">
    <header className="market-page-header"><div><span className="eyebrow">PROT MARKET INTELLIGENCE</span><h1>Thị trường</h1><p>Độ rộng thị trường, sức khỏe ngành và áp lực giá–khối lượng trên cùng phiên EOD.</p></div><label className="market-date">Phiên quan sát<select aria-label="Chọn phiên Market Health" value={day} onChange={event => setSelectedDate(event.target.value)} disabled={!market.data?.dates.length}>{market.data?.dates.map(date => <option key={date} value={date}>{formatDate(date)}</option>)}</select></label></header>
    {(symbols.isError || market.isError || history.isError || memberships.isError) && <p className="market-error" role="alert">Không tải được thống kê thị trường. Hãy thử tải lại trang.</p>}
    <section className="panel market-universe-panel" aria-label="Prot Universe"><div className="market-section-head"><div><span className="eyebrow">01 · PHẠM VI DỮ LIỆU</span><h2>Prot Universe</h2><p>Hai vai trò hiện dùng cùng danh sách mã hoạt động; mở rộng tập quan sát sau này sẽ không tự mở rộng Core Engine.</p></div><a className="market-link" href="#universe">Danh sách cổ phiếu <ArrowUpRight size={16}/></a></div>
      <div className="market-universe-grid"><div><span>Core Engine quét</span><strong>{universe.length}</strong><small>Trading Universe</small></div><div><span>Market Health quan sát</span><strong>{breadth?.universe_size ?? '—'}</strong><small>Observation Universe · hiện cùng tập Core</small></div><div><span>Đúng phiên {formatDate(day)}</span><strong>{breadth?.observed_count ?? '—'}/{breadth?.eligible_count ?? '—'}</strong><small>{breadth?.coverage_ratio == null ? 'Chưa tính độ phủ' : `${pct(breadth.coverage_ratio * 100)} mẫu đủ điều kiện`} · {breadth?.coverage_status ?? 'Chờ EOD'}</small></div><div><span>Thiếu / chưa đủ lịch sử</span><strong>{missing} / {insufficient}</strong><small>Không dùng mã thiếu để chấm ngành</small></div></div>
      <div className="market-universe-breakdown"><div><h3>Theo sàn</h3><div>{exchangeCounts.map(([exchange, count]) => <a key={exchange} href={`#universe?exchange=${encodeURIComponent(exchange)}`}>{exchange === 'HOSE' ? 'HSX' : exchange}<b>{count}</b></a>)}</div></div><div><h3>Theo nhóm ngành Prot</h3><div>{[...sectorCounts].sort((a, b) => b[1] - a[1]).map(([sector, count]) => <a key={sector} href={sectorLink(sector)}>{sector}<b>{count}</b></a>)}</div></div></div>
    </section>
    <section className="panel market-sector-panel" aria-label="Thống kê ngành"><div className="market-section-head"><div><span className="eyebrow">02 · ĐỌC NGÀNH</span><h2>{section === 'health' ? 'Sức khỏe ngành' : 'Sector Flow'}</h2><p>{section === 'health' ? 'Sức khỏe xu hướng giá; không phải khuyến nghị mua.' : 'Dấu vết áp lực giá–khối lượng; không xác định danh tính nhà đầu tư.'}</p></div><div className="market-section-switch" role="tablist" aria-label="Loại thống kê ngành" onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'health' : event.key === 'End' ? 'flow' : section === 'health' ? 'flow' : 'health'; setSection(next); event.currentTarget.querySelector<HTMLButtonElement>(`#market-tab-${next}`)?.focus() }}><button type="button" id="market-tab-health" role="tab" aria-controls="market-sector-content" aria-selected={section === 'health'} tabIndex={section === 'health' ? 0 : -1} className={section === 'health' ? 'active' : ''} onClick={() => setSection('health')}>Sức khỏe</button><button type="button" id="market-tab-flow" role="tab" aria-controls="market-sector-content" aria-selected={section === 'flow'} tabIndex={section === 'flow' ? 0 : -1} className={section === 'flow' ? 'active' : ''} onClick={() => setSection('flow')}>Sector Flow</button></div></div>
      <div className="market-period-bar"><div className="market-period-switch" role="group" aria-label="Khoảng thời gian thống kê ngành">{(Object.entries(SECTOR_PERIODS) as [SectorPeriod, { label: string; sessions: number }][]).map(([key, value]) => <button key={key} type="button" aria-pressed={period === key} className={period === key ? 'active' : ''} onClick={() => setPeriod(key)}>{value.label}</button>)}</div><small>{periodRows.length}/{SECTOR_PERIODS[period].sessions} phiên · {formatDate(periodRows.at(-1)?.trading_date)}–{formatDate(day)}</small></div>
      <div className="market-sector-tools"><label><Search size={16}/><input type="search" aria-label="Tìm nhóm ngành" placeholder="Tìm nhóm ngành…" value={search} onChange={event => setSearch(event.target.value)}/></label><span>{visible.length} nhóm ngành · {formatDate(day)}</span></div>
      <div className="market-table-scroll" id="market-sector-content" role="tabpanel" aria-labelledby={`market-tab-${section}`} tabIndex={0}><table className="market-sector-table"><thead>{section === 'health' ? <tr><th>Hạng</th><th>Nhóm ngành</th><th>Điểm</th><th>Δ kỳ</th><th>Phiên khỏe</th><th>Mẫu</th><th>Trên SMA50</th><th>Tăng / giảm</th><th>Trạng thái</th></tr> : <tr><th>Hạng</th><th>Nhóm ngành</th><th>Flow 20 phiên</th><th>Δ kỳ</th><th>Phiên dương</th><th>Mẫu</th><th>Dương / âm</th><th>Vào / ra phiên</th><th>GTGD / TB20</th><th>Đánh giá</th></tr>}</thead><tbody>{visible.map((row, index) => {
        const summary = section === 'health' ? row.healthHistory : row.flowHistory
        const eligible = section === 'health' ? row.healthQualified : row.flowQualified
        const qualified = eligible && summary.complete
        const status = !eligible ? 'Mẫu mỏng / thiếu dữ liệu' : !summary.complete ? 'Thiếu phiên lịch sử' : section === 'health' ? stateLabel(row.market_health_state) : 'Đủ mẫu quan sát'
        return <tr key={row.sector} className={`${qualified ? '' : 'market-thin-row'}${focused?.sector === row.sector ? ' market-selected-row' : ''}`}><td data-label="Hạng">{qualified ? String(index + 1).padStart(2, '0') : '—'}</td><td data-label="Nhóm ngành" className="market-sector-name"><button type="button" onClick={() => setSelectedSector(row.sector)} aria-label={`Xem lịch sử ${section === 'health' ? 'sức khỏe' : 'Sector Flow'} ngành ${row.sector}`}>{row.sector}</button><a href={sectorLink(row.sector)} aria-label={`Mở danh sách cổ phiếu ngành ${row.sector}`}><ArrowUpRight size={14}/></a></td>{section === 'health' ? <><td data-label="Điểm"><strong>{score(row.market_health_score)}</strong></td><td data-label="Δ kỳ">{signed(summary.scoreChange)}</td><td data-label="Phiên khỏe">{summary.persistencePct == null ? '—' : `${summary.persistencePct}% · ${summary.observedSessions}/${summary.availableSessions}`}</td><td data-label="Mẫu">{row.sample_size}/{row.total}</td><td data-label="Trên SMA50">{pct(row.pct_above_sma50)}</td><td data-label="Tăng / giảm">{row.advance_count ?? 0} / {row.decline_count ?? 0}</td><td data-label="Trạng thái"><span className={`market-state ${qualified ? row.market_health_state?.toLowerCase() ?? '' : ''}`}>{status}</span></td></> : <><td data-label="Flow 20 phiên"><strong className={Number(row.flow_median_score) < 0 ? 'negative' : 'positive'}>{row.flow_median_score == null ? '—' : signed(Number(row.flow_median_score))}</strong></td><td data-label="Δ kỳ">{signed(summary.scoreChange)}</td><td data-label="Phiên dương">{summary.persistencePct == null ? '—' : `${summary.persistencePct}% · ${summary.observedSessions}/${summary.availableSessions}`}</td><td data-label="Mẫu">{row.flow_observed_count ?? 0}/{row.total}</td><td data-label="Dương / âm">{row.flow_positive_count ?? 0} / {row.flow_negative_count ?? 0}</td><td data-label="Vào / ra phiên">{row.flow_in_count ?? 0} / {row.flow_out_count ?? 0}</td><td data-label="GTGD / TB20">{row.relativeTurnover == null ? '—' : `${row.relativeTurnover.toFixed(1)}×`}</td><td data-label="Đánh giá"><span className={`market-state ${qualified ? 'flow-ready' : ''}`}>{status}</span></td></>}</tr>
      })}</tbody></table>{!visible.length && <p className="market-empty">{market.isLoading || history.isLoading ? 'Đang tải lịch sử ngành…' : 'Chưa có nhóm ngành phù hợp hoặc dữ liệu phiên này chưa sẵn sàng.'}</p>}</div>
      {focused && focusedHistory && <section className="market-sector-detail" aria-label={`Lịch sử ${focused.sector}`}><div className="market-sector-detail-head"><div><span className="eyebrow">XU HƯỚNG {SECTOR_PERIODS[period].label.toUpperCase()}</span><h3>{focused.sector}</h3></div><a href={sectorLink(focused.sector)}>Xem cổ phiếu <ArrowUpRight size={14}/></a></div><div className="market-sector-detail-stats"><div><span>Điểm phiên cuối</span><strong>{section === 'health' ? score(focused.market_health_score) : signed(sectorValue(focused, 'flow'))}</strong></div><div><span>Thay đổi điểm</span><strong>{signed(focusedHistory.scoreChange)}</strong></div><div><span>Đổi hạng</span><strong>{rankMove(focusedHistory.rankChange)}</strong></div><div><span>{section === 'health' ? 'Phiên khỏe' : 'Phiên Flow dương'}</span><strong>{focusedHistory.persistencePct == null ? '—' : `${focusedHistory.persistencePct}%`}</strong></div><div><span>Độ phủ lịch sử</span><strong>{focusedHistory.observedSessions}/{SECTOR_PERIODS[period].sessions}</strong></div>{section === 'flow' && <div><span>GTGD tương đối</span><strong>{focused.relativeTurnover == null ? '—' : `${focused.relativeTurnover.toFixed(1)}×`}</strong></div>}</div><SectorTrend observations={focusedHistory.observations} view={section} sector={focused.sector}/><small>{section === 'flow' ? 'Flow là áp lực giá–khối lượng 20 phiên; GTGD tương đối là tỷ trọng trong Prot Universe so với bình quân 20 phiên trước, không phải mua ròng.' : 'Điểm sức khỏe đo độ rộng xu hướng; đường lịch sử không phải tín hiệu mua.'}</small></section>}
      <div className="market-footnote"><span>Chỉ xếp hạng khi phiên cuối có ≥5 mã, độ phủ ngành ≥80% và ≥80% số phiên kỳ quan sát đủ mẫu. Flow dùng mẫu riêng, không phụ thuộc điểm Sức khỏe ngành.</span><button type="button" aria-expanded={showMethod} onClick={() => setShowMethod(value => !value)}>{showMethod ? 'Ẩn cách tính' : 'Xem cách tính'}</button></div>
      {showMethod && <div className="market-method"><p><strong>Sức khỏe:</strong> trung bình 5 tỷ lệ mã trên SMA20, SMA50, SMA200, có SMA20 &gt; SMA50 &gt; SMA200 và tăng giá so với phiên trước. Mỗi mã có trọng số ngang nhau.</p><p><strong>Sector Flow:</strong> trung vị điểm Prot Flow 20 phiên của các mã đủ dữ liệu; dương/âm là bối cảnh, vào/ra là màu nến gần nhất. Đây là đại diện áp lực OHLCV, không phải tiền mua/bán ròng hay dấu vết chắc chắn của tổ chức.</p><p><strong>Phạm vi:</strong> chỉ các mã đang hoạt động trong Prot Universe. Lịch sử dùng dữ liệu giá đã lưu và nhãn ngành hiện tại; chưa đại diện toàn bộ HOSE hay tái lập VN-Index.</p></div>}
    </section>
  </section>
}
