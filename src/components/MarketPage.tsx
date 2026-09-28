import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Search } from 'lucide-react'
import { useSymbols } from '../hooks/useStockAnalysis'
import { formatDate } from '../lib/date'
import { latestSignalPublication } from '../lib/signalPublication'
import { supabase } from '../lib/supabase'
import '../market-page.css'

type SectorRow = {
  sector: string; sample_size: number; universe_count?: number; coverage_ratio?: number | null
  market_health_score?: number | null; market_health_state?: string
  pct_above_sma50?: number | null; advance_count?: number; decline_count?: number
  flow_observed_count?: number; flow_coverage_ratio?: number | null; flow_median_score?: number | null
  flow_positive_count?: number; flow_negative_count?: number; flow_in_count?: number; flow_out_count?: number
  flow_strong_in_count?: number; flow_strong_out_count?: number
}
type BreadthRow = { trading_date: string; universe_size: number; observed_count: number; eligible_count: number; coverage_ratio: number | null; coverage_status: string; market_health_score: number | null; market_health_state: string; sector_breadth: SectorRow[] }
type Membership = { symbol_id: number; status: string }

const pct = (value: number | null | undefined) => value == null ? '—' : `${Number(value).toFixed(1)}%`
const score = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(1)
const stateLabel = (state?: string) => state === 'RISK_ON' ? 'Tích cực' : state === 'RISK_OFF' ? 'Phòng thủ' : state === 'NEUTRAL' ? 'Trung tính' : 'Chưa đủ dữ liệu'
const sectorName = (value: string | null | undefined) => value?.trim() || 'Chưa phân ngành'
const sectorLink = (sector: string) => `#universe?sector=${encodeURIComponent(sector)}`

export function MarketPage({ authenticated }: { authenticated: boolean }) {
  const symbols = useSymbols(authenticated)
  const [selectedDate, setSelectedDate] = useState('')
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<'health' | 'flow'>('health')
  const [showMethod, setShowMethod] = useState(false)
  const market = useQuery({
    queryKey: ['market-statistics-history'], enabled: authenticated && Boolean(supabase), staleTime: 60_000, refetchInterval: 60_000,
    queryFn: async () => {
      const publication = await latestSignalPublication()
      if (!publication) return { publication: null, rows: [] as BreadthRow[] }
      const { data, error } = await supabase!.from('market_breadth_snapshots')
        .select('trading_date,universe_size,observed_count,eligible_count,coverage_ratio,coverage_status,market_health_score,market_health_state,sector_breadth')
        .lte('trading_date', publication.date).order('trading_date', { ascending: false }).limit(30)
      if (error) throw error
      return { publication, rows: (data ?? []) as BreadthRow[] }
    },
  })
  const day = selectedDate || market.data?.publication?.date || ''
  const breadth = market.data?.rows.find(row => row.trading_date === day)
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
    const globalReady = breadth?.coverage_status === 'COMPLETE' || breadth?.coverage_status === 'DEGRADED'
    const healthQualified = globalReady && item.sample_size >= 5 && coverage >= 0.8
    const flowQualified = healthQualified && (item.flow_observed_count ?? 0) >= 5 && (item.flow_coverage_ratio ?? 0) >= 0.8
    return { ...item, total, coverage, healthQualified, flowQualified }
    })
  }, [breadth, sectorCounts])
  const visible = rows.filter(row => row.sector.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')))
    .sort((a, b) => section === 'health'
      ? Number(b.healthQualified) - Number(a.healthQualified) || Number(b.market_health_score ?? -1) - Number(a.market_health_score ?? -1)
      : Number(b.flowQualified) - Number(a.flowQualified) || Number(b.flow_median_score ?? -101) - Number(a.flow_median_score ?? -101))
  const missing = memberships.data?.filter(item => item.status === 'DATA_MISSING_OR_HALTED' || item.status === 'NOT_ELIGIBLE').length ?? Math.max(0, universe.length - (breadth?.observed_count ?? 0))
  const insufficient = memberships.data?.filter(item => item.status === 'INSUFFICIENT_HISTORY').length ?? 0

  return <section className="workspace-page market-page">
    <header className="market-page-header"><div><span className="eyebrow">PROT MARKET INTELLIGENCE</span><h1>Thị trường</h1><p>Độ rộng thị trường, sức khỏe ngành và áp lực giá–khối lượng trên cùng phiên EOD.</p></div><label className="market-date">Phiên quan sát<select aria-label="Chọn phiên Market Health" value={day} onChange={event => setSelectedDate(event.target.value)} disabled={!market.data?.rows.length}>{market.data?.rows.map(row => <option key={row.trading_date} value={row.trading_date}>{formatDate(row.trading_date)}</option>)}</select></label></header>
    {(symbols.isError || market.isError || memberships.isError) && <p className="market-error" role="alert">Không tải được thống kê thị trường. Hãy thử tải lại trang.</p>}
    <section className="panel market-universe-panel" aria-label="Prot Universe"><div className="market-section-head"><div><span className="eyebrow">01 · PHẠM VI DỮ LIỆU</span><h2>Prot Universe</h2><p>Hai vai trò hiện dùng cùng danh sách mã hoạt động; mở rộng tập quan sát sau này sẽ không tự mở rộng Core Engine.</p></div><a className="market-link" href="#universe">Danh sách cổ phiếu <ArrowUpRight size={16}/></a></div>
      <div className="market-universe-grid"><div><span>Core Engine quét</span><strong>{universe.length}</strong><small>Trading Universe</small></div><div><span>Market Health quan sát</span><strong>{breadth?.universe_size ?? '—'}</strong><small>Observation Universe · hiện cùng tập Core</small></div><div><span>Đúng phiên {formatDate(day)}</span><strong>{breadth?.observed_count ?? '—'}/{breadth?.eligible_count ?? '—'}</strong><small>{breadth?.coverage_ratio == null ? 'Chưa tính độ phủ' : `${pct(breadth.coverage_ratio * 100)} mẫu đủ điều kiện`} · {breadth?.coverage_status ?? 'Chờ EOD'}</small></div><div><span>Thiếu / chưa đủ lịch sử</span><strong>{missing} / {insufficient}</strong><small>Không dùng mã thiếu để chấm ngành</small></div></div>
      <div className="market-universe-breakdown"><div><h3>Theo sàn</h3><div>{exchangeCounts.map(([exchange, count]) => <a key={exchange} href={`#universe?exchange=${encodeURIComponent(exchange)}`}>{exchange === 'HOSE' ? 'HSX' : exchange}<b>{count}</b></a>)}</div></div><div><h3>Theo nhóm ngành Prot</h3><div>{[...sectorCounts].sort((a, b) => b[1] - a[1]).map(([sector, count]) => <a key={sector} href={sectorLink(sector)}>{sector}<b>{count}</b></a>)}</div></div></div>
    </section>
    <section className="panel market-sector-panel" aria-label="Thống kê ngành"><div className="market-section-head"><div><span className="eyebrow">02 · ĐỌC NGÀNH</span><h2>{section === 'health' ? 'Sức khỏe ngành' : 'Sector Flow'}</h2><p>{section === 'health' ? 'Sức khỏe xu hướng giá; không phải khuyến nghị mua.' : 'Dấu vết áp lực giá–khối lượng; không xác định danh tính nhà đầu tư.'}</p></div><div className="market-section-switch" role="tablist" aria-label="Loại thống kê ngành" onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'health' : event.key === 'End' ? 'flow' : section === 'health' ? 'flow' : 'health'; setSection(next); event.currentTarget.querySelector<HTMLButtonElement>(`#market-tab-${next}`)?.focus() }}><button type="button" id="market-tab-health" role="tab" aria-controls="market-sector-content" aria-selected={section === 'health'} tabIndex={section === 'health' ? 0 : -1} className={section === 'health' ? 'active' : ''} onClick={() => setSection('health')}>Sức khỏe</button><button type="button" id="market-tab-flow" role="tab" aria-controls="market-sector-content" aria-selected={section === 'flow'} tabIndex={section === 'flow' ? 0 : -1} className={section === 'flow' ? 'active' : ''} onClick={() => setSection('flow')}>Sector Flow</button></div></div>
      <div className="market-sector-tools"><label><Search size={16}/><input type="search" aria-label="Tìm nhóm ngành" placeholder="Tìm nhóm ngành…" value={search} onChange={event => setSearch(event.target.value)}/></label><span>{visible.length} nhóm ngành · {formatDate(day)}</span></div>
      <div className="market-table-scroll" id="market-sector-content" role="tabpanel" aria-labelledby={`market-tab-${section}`} tabIndex={0}><table className="market-sector-table"><thead>{section === 'health' ? <tr><th>Hạng</th><th>Nhóm ngành</th><th>Điểm</th><th>Mẫu</th><th>Trên SMA50</th><th>Tăng / giảm</th><th>Trạng thái</th></tr> : <tr><th>Hạng</th><th>Nhóm ngành</th><th>Flow 20 phiên</th><th>Mẫu</th><th>Dương / âm</th><th>Vào / ra phiên</th><th>Đánh giá</th></tr>}</thead><tbody>{visible.map((row, index) => {
        const qualified = section === 'health' ? row.healthQualified : row.flowQualified
        return <tr key={row.sector} className={qualified ? '' : 'market-thin-row'}><td>{qualified ? String(index + 1).padStart(2, '0') : '—'}</td><td><a href={sectorLink(row.sector)}>{row.sector} <ArrowUpRight size={13}/></a></td>{section === 'health' ? <><td><strong>{score(row.market_health_score)}</strong></td><td>{row.sample_size}/{row.total}</td><td>{pct(row.pct_above_sma50)}</td><td>{row.advance_count ?? 0} / {row.decline_count ?? 0}</td><td><span className={`market-state ${row.market_health_state?.toLowerCase() ?? ''}`}>{qualified ? stateLabel(row.market_health_state) : 'Mẫu mỏng / thiếu dữ liệu'}</span></td></> : <><td><strong className={Number(row.flow_median_score) < 0 ? 'negative' : 'positive'}>{row.flow_median_score == null ? '—' : `${Number(row.flow_median_score) > 0 ? '+' : ''}${score(row.flow_median_score)}`}</strong></td><td>{row.flow_observed_count ?? 0}/{row.total}</td><td>{row.flow_positive_count ?? 0} / {row.flow_negative_count ?? 0}</td><td>{row.flow_in_count ?? 0} / {row.flow_out_count ?? 0}</td><td><span className={`market-state ${qualified ? 'flow-ready' : ''}`}>{qualified ? 'Đủ mẫu quan sát' : 'Mẫu mỏng / thiếu Flow'}</span></td></>}</tr>
      })}</tbody></table>{!visible.length && <p className="market-empty">{market.isLoading ? 'Đang tải Market Health…' : 'Chưa có nhóm ngành phù hợp hoặc dữ liệu phiên này chưa sẵn sàng.'}</p>}</div>
      <div className="market-footnote"><span>Chỉ xếp hạng ngành có ≥5 mã quan sát và độ phủ ≥80%; nhóm chưa đủ mẫu vẫn hiện để kiểm tra, không nhận thứ hạng.</span><button type="button" aria-expanded={showMethod} onClick={() => setShowMethod(value => !value)}>{showMethod ? 'Ẩn cách tính' : 'Xem cách tính'}</button></div>
      {showMethod && <div className="market-method"><p><strong>Sức khỏe:</strong> trung bình 5 tỷ lệ mã trên SMA20, SMA50, SMA200, có SMA20 &gt; SMA50 &gt; SMA200 và tăng giá so với phiên trước. Mỗi mã có trọng số ngang nhau.</p><p><strong>Sector Flow:</strong> trung vị điểm Prot Flow 20 phiên của các mã đủ dữ liệu; dương/âm là bối cảnh, vào/ra là màu nến gần nhất. Đây là đại diện áp lực OHLCV, không phải tiền mua/bán ròng hay dấu vết chắc chắn của tổ chức.</p><p><strong>Phạm vi:</strong> chỉ các mã đang hoạt động trong Prot Universe. Lịch sử dùng dữ liệu giá đã lưu và nhãn ngành hiện tại; chưa đại diện toàn bộ HOSE hay tái lập VN-Index.</p></div>}
    </section>
  </section>
}
