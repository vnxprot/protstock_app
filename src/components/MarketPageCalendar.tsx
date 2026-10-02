import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Search } from 'lucide-react'
import { useSymbols } from '../hooks/useStockAnalysis'
import { formatDate } from '../lib/date'
import { latestSignalPublication } from '../lib/signalPublication'
import { calendarBounds, calendarKey, calendarLabel, sectorPeriodSummary, SECTOR_GRAINS, type SectorGrain } from '../lib/sectorCalendar'
import type { BreadthRow, SectorRow, SectorView } from '../lib/sectorHistory'
import { supabase } from '../lib/supabase'
import '../market-page.css'
import { HealthMethodDetails } from './HealthMethodDetails'

type Membership = { symbol_id: number; status: string }
type ChartPoint = { key: string; label: string; score: number | null; complete: boolean }

const pct = (value: number | null | undefined) => value == null ? '—' : `${Number(value).toFixed(1)}%`
const score = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(1)
const signed = (value: number | null | undefined) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`
const sectorName = (value: string | null | undefined) => value?.trim() || 'Chưa phân ngành'
const sectorLink = (sector: string) => `#universe?sector=${encodeURIComponent(sector)}`
const stateLabel = (value: number | null) => value == null ? 'Chưa đủ dữ liệu' : value >= 65 ? 'Tích cực' : value < 35 ? 'Phòng thủ' : 'Trung tính'

async function fetchDates(latestDate: string): Promise<string[]> {
  const { data: index, error: indexError } = await supabase!.from('market_indices').select('id').eq('code', 'VNINDEX').single()
  if (indexError) throw indexError
  const dates: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase!.from('market_index_prices').select('trading_date')
      .eq('index_id', index.id).gte('trading_date', '2021-01-01').lte('trading_date', latestDate)
      .order('trading_date', { ascending: true }).range(offset, offset + 999)
    if (error) throw error
    dates.push(...(data ?? []).map(row => row.trading_date))
    if ((data ?? []).length < 1000) break
  }
  return dates
}

async function fetchBreadth(start: string, end: string): Promise<BreadthRow[]> {
  const rows: BreadthRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase!.from('market_breadth_snapshots')
      .select('trading_date,universe_size,observed_count,eligible_count,coverage_ratio,coverage_status,market_health_score,market_health_state,sector_breadth,health_method_version,health_components')
      .gte('trading_date', start).lte('trading_date', end)
      .order('trading_date', { ascending: true }).range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data ?? []) as BreadthRow[])
    if ((data ?? []).length < 500) break
  }
  return rows
}

function SectorChart({ points, grain, view, selectedKey, onSelect }: {
  points: ChartPoint[]; grain: SectorGrain; view: SectorView; selectedKey: string; onSelect: (key: string) => void
}) {
  if (!points.length) return <p className="market-empty">Chưa có kỳ giao dịch để vẽ biểu đồ.</p>
  return <div className="market-calendar-chart" role="group" aria-label={`Biểu đồ ${view === 'health' ? 'Sức khỏe ngành' : 'Sector Flow'} theo ${grain}`}>
    <div className="market-calendar-chart-scroll">{points.map(point => {
      const value = point.score
      const positive = value != null && value >= 0
      const height = value == null ? 0 : view === 'health' ? Math.max(2, Math.min(100, value)) : Math.max(2, Math.min(50, Math.abs(value) / 2))
      return <button key={point.key} type="button" className={`market-chart-period${selectedKey === point.key ? ' active' : ''}${point.complete ? '' : ' incomplete'}`}
        aria-pressed={selectedKey === point.key} aria-label={`${calendarLabel(point.key, grain)}: ${value == null ? 'chưa có điểm hợp lệ' : `${score(value)} điểm`}${point.complete ? '' : ', thiếu độ phủ'}`}
        title={`${calendarLabel(point.key, grain)} · ${value == null ? 'Chưa đủ dữ liệu' : `${score(value)} điểm`}`}
        onClick={() => onSelect(point.key)}>
        <span className={`market-chart-track ${view === 'flow' ? 'is-flow' : ''}`}><span className={`market-chart-bar ${positive ? 'positive' : 'negative'}`}
          style={view === 'flow' ? { height: `${height}%`, [positive ? 'bottom' : 'top']: '50%' } : { height: `${height}%`, bottom: 0 }}/></span>
        <span className="market-chart-value">{value == null ? '—' : score(value)}</span>
        <span className="market-chart-label">{grain === 'day' ? point.key.slice(8, 10) : grain === 'week' ? `${point.key.slice(8, 10)}/${point.key.slice(5, 7)}` : grain === 'month' ? `T${Number(point.key.slice(5, 7))}` : grain === 'quarter' ? `Q${point.key.slice(-1)}` : point.key}</span>
      </button>
    })}</div>
    <small>Chọn một cột để xem đúng kỳ đó. Cột mờ: độ phủ chưa đạt chuẩn; không dùng để xếp hạng.</small>
  </div>
}

export function MarketPage({ authenticated }: { authenticated: boolean }) {
  const symbols = useSymbols(authenticated)
  const [anchorDate, setAnchorDate] = useState('')
  const [grain, setGrain] = useState<SectorGrain>('day')
  const [section, setSection] = useState<SectorView>('health')
  const [selectedSector, setSelectedSector] = useState('')
  const [search, setSearch] = useState('')
  const [showMethod, setShowMethod] = useState(false)
  const chartRef = useRef<HTMLElement>(null)

  const market = useQuery({
    queryKey: ['market-calendar-dates'], enabled: authenticated && Boolean(supabase), staleTime: 60_000, refetchInterval: 60_000,
    queryFn: async () => {
      const publication = await latestSignalPublication()
      return publication ? { publication, dates: await fetchDates(publication.date) } : { publication: null, dates: [] as string[] }
    },
  })
  const marketDates = market.data?.dates ?? []
  const latestDate = marketDates.at(-1) ?? market.data?.publication?.date ?? ''
  const activeDate = anchorDate || latestDate
  const selectedKey = activeDate ? calendarKey(activeDate, grain) : ''
  const selectedYear = activeDate.slice(0, 4)
  const years = useMemo(() => [...new Set(marketDates.map(date => date.slice(0, 4)))].reverse(), [marketDates])
  const yearDates = useMemo(() => marketDates.filter(date => date.startsWith(selectedYear)), [marketDates, selectedYear])
  const periodOptions = useMemo(() => {
    if (grain === 'year') return years.slice().reverse()
    if (grain === 'month') return Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, '0')}`).filter(key => key <= latestDate.slice(0, 7))
    if (grain === 'quarter') return Array.from({ length: 4 }, (_, i) => `${selectedYear}-Q${i + 1}`).filter(key => calendarBounds(key, 'quarter').start <= latestDate)
    return [...new Set(yearDates.map(date => calendarKey(date, grain)))].reverse()
  }, [grain, latestDate, selectedYear, yearDates, years])
  const scopeStart = grain === 'year' ? '2021-01-01' : grain === 'day' ? `${activeDate.slice(0, 7)}-01` : grain === 'week' ? calendarKey(`${selectedYear}-01-01`, 'week') : `${selectedYear}-01-01`
  const scopeEnd = grain === 'year' ? latestDate : grain === 'day' ? calendarBounds(activeDate.slice(0, 7), 'month').end : grain === 'week' ? calendarBounds(calendarKey(`${selectedYear}-12-31`, 'week'), 'week').end : `${selectedYear}-12-31`
  const history = useQuery({
    queryKey: ['market-calendar-breadth', scopeStart, scopeEnd], enabled: authenticated && Boolean(supabase) && Boolean(scopeStart) && Boolean(scopeEnd), staleTime: 60_000, refetchInterval: 60_000,
    queryFn: () => fetchBreadth(scopeStart, scopeEnd > latestDate ? latestDate : scopeEnd),
  })
  const scopeRows = history.data ?? []
  const periodMarketDates = useMemo(() => marketDates.filter(date => calendarKey(date, grain) === selectedKey), [marketDates, grain, selectedKey])
  const periodRows = useMemo(() => scopeRows.filter(row => calendarKey(row.trading_date, grain) === selectedKey), [scopeRows, grain, selectedKey])
  const breadth = periodRows.at(-1)
  const day = breadth?.trading_date ?? ''
  const provisional = Boolean(selectedKey && latestDate && calendarBounds(selectedKey, grain).end > latestDate)
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
    const latest = new Map<string, SectorRow>()
    periodRows.forEach(dayRow => dayRow.sector_breadth.forEach(item => latest.set(item.sector, item)))
    return [...new Set([...sectorCounts.keys(), ...latest.keys()])].map(sector => {
      const last = latest.get(sector)
      return {
        sector, last, total: sectorCounts.get(sector) ?? last?.universe_count ?? 0,
        summary: sectorPeriodSummary(periodRows, periodMarketDates, sector, section),
      }
    })
  }, [periodRows, periodMarketDates, section, sectorCounts])
  const visible = rows.filter(row => row.sector.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')))
    .sort((a, b) => Number(b.summary.complete) - Number(a.summary.complete)
      || Number(b.summary.score ?? (section === 'health' ? -1 : -101)) - Number(a.summary.score ?? (section === 'health' ? -1 : -101))
      || Number(b.summary.persistencePct ?? -1) - Number(a.summary.persistencePct ?? -1))
  const focused = visible.find(row => row.sector === selectedSector) ?? visible[0]
  const chartKeys = useMemo(() => {
    const dates = grain === 'year' ? marketDates : grain === 'day' ? marketDates.filter(date => date.startsWith(activeDate.slice(0, 7))) : yearDates
    if (grain === 'month') return Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, '0')}`).filter(key => key <= latestDate.slice(0, 7))
    if (grain === 'quarter') return Array.from({ length: 4 }, (_, i) => `${selectedYear}-Q${i + 1}`).filter(key => calendarBounds(key, 'quarter').start <= latestDate)
    return [...new Set(dates.map(date => calendarKey(date, grain)))]
  }, [activeDate, grain, latestDate, marketDates, selectedYear, yearDates])
  const chartPoints = useMemo(() => focused ? chartKeys.map(key => {
    const dates = marketDates.filter(date => calendarKey(date, grain) === key)
    const data = scopeRows.filter(row => calendarKey(row.trading_date, grain) === key)
    const summary = sectorPeriodSummary(data, dates, focused.sector, section)
    return { key, label: calendarLabel(key, grain), score: summary.score, complete: summary.complete }
  }) : [], [chartKeys, focused, grain, marketDates, scopeRows, section])
  const missing = memberships.data?.filter(item => item.status === 'DATA_MISSING_OR_HALTED' || item.status === 'NOT_ELIGIBLE').length ?? (breadth ? Math.max(0, universe.length - breadth.observed_count) : 0)
  const insufficient = memberships.data?.filter(item => item.status === 'INSUFFICIENT_HISTORY').length ?? 0
  const chooseKey = (key: string) => {
    const dates = marketDates.filter(date => calendarKey(date, grain) === key)
    setAnchorDate(dates.at(-1) ?? calendarBounds(key, grain).start)
  }
  const chooseSector = (sector: string) => {
    setSelectedSector(sector)
    requestAnimationFrame(() => chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return <section className="workspace-page market-page">
    <header className="market-page-header"><div><span className="eyebrow">PROT MARKET INTELLIGENCE</span><h1>Thị trường</h1><p>Chọn một phiên hoặc một kỳ lịch để so sánh sức khỏe ngành và áp lực giá–khối lượng.</p></div><div className="market-date">Dữ liệu thị trường đến<strong>{formatDate(latestDate)}</strong></div></header>
    {(symbols.isError || market.isError || history.isError || memberships.isError) && <p className="market-error" role="alert">Không tải được thống kê thị trường. Hãy thử tải lại trang.</p>}
    <section className="panel market-universe-panel" aria-label="Prot Universe"><div className="market-section-head"><div><span className="eyebrow">01 · PHẠM VI DỮ LIỆU</span><h2>Prot Universe</h2><p>Hai vai trò hiện dùng cùng danh sách mã hoạt động; mở rộng tập quan sát sau này sẽ không tự mở rộng Core Engine.</p></div><a className="market-link" href="#universe">Danh sách cổ phiếu <ArrowUpRight size={16}/></a></div>
      <div className="market-universe-grid"><div><span>Core Engine quét</span><strong>{universe.length}</strong><small>Trading Universe</small></div><div><span>Market Health quan sát</span><strong>{breadth?.universe_size ?? '—'}</strong><small>Observation Universe · hiện cùng tập Core</small></div><div><span>Phiên cuối trong kỳ {formatDate(day)}</span><strong>{breadth?.observed_count ?? '—'}/{breadth?.eligible_count ?? '—'}</strong><small>{breadth?.coverage_ratio == null ? 'Chưa tính độ phủ' : `${pct(breadth.coverage_ratio * 100)} mẫu đủ điều kiện`} · {breadth?.coverage_status ?? 'Chờ EOD'}</small></div><div><span>Thiếu / chưa đủ lịch sử</span><strong>{missing} / {insufficient}</strong><small>Không dùng mã thiếu để chấm ngành</small></div></div>
      <HealthMethodDetails components={breadth?.health_components} version={breadth?.health_method_version}/>
      <div className="market-universe-breakdown"><div><h3>Theo sàn</h3><div>{exchangeCounts.map(([exchange, count]) => <a key={exchange} href={`#universe?exchange=${encodeURIComponent(exchange)}`}>{exchange === 'HOSE' ? 'HSX' : exchange}<b>{count}</b></a>)}</div></div><div><h3>Theo nhóm ngành Prot</h3><div>{[...sectorCounts].sort((a, b) => b[1] - a[1]).map(([sector, count]) => <a key={sector} href={sectorLink(sector)}>{sector}<b>{count}</b></a>)}</div></div></div>
    </section>
    <section className="panel market-sector-panel" aria-label="Thống kê ngành"><div className="market-section-head"><div><span className="eyebrow">02 · ĐỌC NGÀNH</span><h2>{section === 'health' ? 'Sức khỏe ngành' : 'Sector Flow'}</h2><p>{section === 'health' ? 'Sức khỏe xu hướng giá; không phải khuyến nghị mua.' : 'Dấu vết áp lực giá–khối lượng; không xác định danh tính nhà đầu tư.'}</p></div><div className="market-section-switch" role="tablist" aria-label="Loại thống kê ngành" onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'health' : event.key === 'End' ? 'flow' : section === 'health' ? 'flow' : 'health'; setSection(next); event.currentTarget.querySelector<HTMLButtonElement>(`#market-tab-${next}`)?.focus() }}><button type="button" id="market-tab-health" role="tab" aria-controls="market-sector-content" aria-selected={section === 'health'} tabIndex={section === 'health' ? 0 : -1} className={section === 'health' ? 'active' : ''} onClick={() => setSection('health')}>Sức khỏe</button><button type="button" id="market-tab-flow" role="tab" aria-controls="market-sector-content" aria-selected={section === 'flow'} tabIndex={section === 'flow' ? 0 : -1} className={section === 'flow' ? 'active' : ''} onClick={() => setSection('flow')}>Sector Flow</button></div></div>
      <div className="market-calendar-controls"><div className="market-period-switch" role="group" aria-label="Đơn vị thời gian">{SECTOR_GRAINS.map(item => <button key={item.key} type="button" aria-pressed={grain === item.key} className={grain === item.key ? 'active' : ''} onClick={() => setGrain(item.key)}>{item.label}</button>)}</div><div className="market-calendar-selects">{grain !== 'year' && <label>Năm<select value={selectedYear} onChange={event => setAnchorDate(marketDates.filter(date => date.startsWith(event.target.value)).at(-1) ?? `${event.target.value}-01-01`)}>{years.map(year => <option key={year} value={year}>{year}</option>)}</select></label>}<label>{grain === 'year' ? 'Năm' : grain === 'day' ? 'Phiên' : grain === 'week' ? 'Tuần' : grain === 'month' ? 'Tháng' : 'Quý'}<select value={selectedKey} onChange={event => chooseKey(event.target.value)}>{periodOptions.map(key => <option key={key} value={key}>{calendarLabel(key, grain)}</option>)}</select></label></div></div>
      <p className="market-calendar-meta"><strong>{selectedKey ? calendarLabel(selectedKey, grain) : 'Chưa có kỳ'}</strong> · {periodMarketDates.length} phiên giao dịch VN-Index · {periodRows.length} phiên có Market Health{provisional ? ' · Kỳ đang diễn ra' : ''}</p>
      {focused && <section className="market-sector-detail" ref={chartRef} aria-label={`Biểu đồ ngành ${focused.sector}`}><div className="market-sector-detail-head"><div><span className="eyebrow">BIỂU ĐỒ {section === 'health' ? 'SỨC KHỎE' : 'SECTOR FLOW'}</span><h3>{focused.sector}</h3></div><a href={sectorLink(focused.sector)}>Xem cổ phiếu <ArrowUpRight size={14}/></a></div><div className="market-sector-detail-stats"><div><span>Điểm kỳ (trung vị)</span><strong>{section === 'health' ? score(focused.summary.score) : signed(focused.summary.score)}</strong></div><div><span>Điểm phiên cuối hợp lệ</span><strong>{section === 'health' ? score(focused.summary.lastValue) : signed(focused.summary.lastValue)}</strong></div><div><span>Thay đổi đầu–cuối kỳ</span><strong>{signed(focused.summary.change)}</strong></div><div><span>{section === 'health' ? 'Phiên khỏe' : 'Phiên Flow dương'}</span><strong>{focused.summary.persistencePct == null ? '—' : `${focused.summary.persistencePct}%`}</strong></div><div><span>Phiên hợp lệ / giao dịch</span><strong>{focused.summary.qualified}/{focused.summary.expected}</strong></div>{section === 'flow' && <div><span>Thị phần GTGD ước tính</span><strong>{pct(focused.summary.turnoverSharePct)}</strong></div>}</div><SectorChart points={chartPoints} grain={grain} view={section} selectedKey={selectedKey} onSelect={chooseKey}/><small>{section === 'flow' ? 'Flow là áp lực giá–khối lượng với nền 20 phiên; thị phần GTGD là ước tính giá × khối lượng trong Prot Universe, không phải mua ròng.' : 'Điểm kỳ là trung vị các phiên hợp lệ; điểm sức khỏe không phải tín hiệu mua.'}</small></section>}
      <div className="market-sector-tools"><label><Search size={16}/><input type="search" aria-label="Tìm nhóm ngành" placeholder="Tìm nhóm ngành…" value={search} onChange={event => setSearch(event.target.value)}/></label><span>{visible.length} nhóm ngành · {selectedKey ? calendarLabel(selectedKey, grain) : '—'}</span></div>
      <div className="market-table-scroll" id="market-sector-content" role="tabpanel" aria-labelledby={`market-tab-${section}`} tabIndex={0}><table className="market-sector-table"><thead>{section === 'health' ? <tr><th>Hạng</th><th>Nhóm ngành</th><th>Điểm kỳ</th><th>Phiên cuối</th><th>Phiên khỏe</th><th>Độ phủ</th><th>Mẫu cuối</th><th>Trạng thái</th></tr> : <tr><th>Hạng</th><th>Nhóm ngành</th><th>Flow kỳ</th><th>Phiên cuối</th><th>Phiên dương</th><th>Độ phủ</th><th>Mẫu Flow</th><th>Thị phần GTGD</th><th>Trạng thái</th></tr>}</thead><tbody>{visible.map((row, index) => {
        const summary = row.summary
        const qualified = summary.complete && summary.score != null
        const status = summary.lastRow?.sample_warning === 'SMALL_SAMPLE' ? 'Mẫu ngành nhỏ' : summary.reason ?? (provisional ? 'Kỳ đang diễn ra' : section === 'health' ? stateLabel(summary.score) : 'Đủ mẫu quan sát')
        return <tr key={row.sector} tabIndex={0} aria-label={`Xem biểu đồ ngành ${row.sector}`} onClick={() => chooseSector(row.sector)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); chooseSector(row.sector) } }} className={`${qualified ? '' : 'market-thin-row'}${focused?.sector === row.sector ? ' market-selected-row' : ''}`}><td data-label="Hạng">{qualified ? String(index + 1).padStart(2, '0') : '—'}</td><td data-label="Nhóm ngành" className="market-sector-name"><button type="button" onClick={event => { event.stopPropagation(); chooseSector(row.sector) }}>{row.sector}</button><a href={sectorLink(row.sector)} onClick={event => event.stopPropagation()} aria-label={`Mở danh sách cổ phiếu ngành ${row.sector}`}><ArrowUpRight size={14}/></a></td><td data-label={section === 'health' ? 'Điểm kỳ' : 'Flow kỳ'}><strong className={section === 'flow' ? Number(summary.score) < 0 ? 'negative' : 'positive' : ''}>{section === 'health' ? score(summary.score) : signed(summary.score)}</strong></td><td data-label="Phiên cuối">{section === 'health' ? score(summary.lastValue) : signed(summary.lastValue)}</td><td data-label={section === 'health' ? 'Phiên khỏe' : 'Phiên dương'}>{summary.persistencePct == null ? '—' : `${summary.persistencePct}%`}</td><td data-label="Độ phủ">{summary.qualified}/{summary.expected}</td><td data-label="Mẫu cuối">{section === 'health' ? `${summary.lastRow?.sample_size ?? 0}/${row.total}` : `${summary.lastRow?.flow_observed_count ?? 0}/${row.total}`}</td>{section === 'flow' && <td data-label="Thị phần GTGD">{pct(summary.turnoverSharePct)}</td>}<td data-label="Trạng thái"><span className={`market-state ${qualified ? section === 'flow' ? 'flow-ready' : summary.score! >= 65 ? 'risk_on' : summary.score! < 35 ? 'risk_off' : 'neutral' : ''}`}>{status}</span></td></tr>
      })}</tbody></table>{!visible.length && <p className="market-empty">{history.isLoading || market.isLoading ? 'Đang tải dữ liệu ngành…' : 'Không có ngành phù hợp hoặc kỳ này chưa có dữ liệu.'}</p>}</div>
      <div className="market-footnote"><span>Kỳ lịch thực, không phải cửa sổ 5/20/60/250 phiên. Chỉ xếp hạng khi ≥80% phiên VN-Index trong kỳ có mẫu ngành hợp lệ; mỗi phiên cần ≥5 mã và độ phủ ngành ≥80%.</span><button type="button" aria-expanded={showMethod} onClick={() => setShowMethod(value => !value)}>{showMethod ? 'Ẩn cách tính' : 'Xem cách tính'}</button></div>
      {showMethod && <div className="market-method"><p><strong>Sức khỏe:</strong> điểm kỳ là trung vị điểm sức khỏe của các phiên đủ mẫu; “phiên khỏe” là tỷ lệ phiên có điểm ≥65. Điểm một phiên gồm các tỷ lệ trên SMA20/50/200, cấu trúc MA và số mã tăng.</p><p><strong>Sector Flow:</strong> điểm kỳ là trung vị điểm Flow ngành của các phiên đủ mẫu; “phiên dương” là tỷ lệ phiên có Flow &gt;0. Flow mỗi phiên có nền 20 phiên; không diễn giải điểm kỳ là lượng tiền vào ròng của cả tháng/quý.</p><p><strong>Phạm vi:</strong> mẫu số là các ngày giao dịch VN-Index có dữ liệu đến phiên đã công bố. Lịch sử tính theo Prot Universe và nhãn ngành hiện tại; nhóm đổi ngành hoặc mã mới niêm yết có thể có độ phủ thấp. Kỳ đang diễn ra là tạm thời.</p></div>}
    </section>
  </section>
}
