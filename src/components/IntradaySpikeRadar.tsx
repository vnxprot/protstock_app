import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpRight, Clock3, Database, Search, Waves } from 'lucide-react'
import { formatDate } from '../lib/date'
import { supabase } from '../lib/supabase'
import { SoftSelect } from './SoftSelect'
import { DateField } from './DateField'
import { ResearchPagination } from './ResearchPagination'
import './intraday-spikes.css'

type Direction = 'UP' | 'DOWN' | 'FLAT' | 'REVERSED_UP' | 'REVERSED_DOWN'
type SpikeEvent = {
  id: number; symbol_id: number; trading_date: string; start_time: string; end_time: string
  duration_minutes: number; volume: number; value_vnd: number; volume_ratio: number
  price_change_pct: number; close_hold_pct: number | null; direction: Direction
  baseline_sessions: number; source: string; symbol: string; sector: string | null; exchange: string | null
}
type MinuteBar = { t: string; o: number; h: number; l: number; c: number; v: number }
type MinuteDay = { bars: MinuteBar[]; coverage_status: string; bar_count: number; minute_volume: number; daily_volume: number | null }
type Mode = 'market' | 'screener'

const directionName: Record<Direction, string> = {
  UP: 'Tăng và giữ giá', DOWN: 'Giảm và giữ giá', FLAT: 'Giá ít đổi',
  REVERSED_UP: 'Tăng rồi bị bán ngược', REVERSED_DOWN: 'Giảm rồi phục hồi',
}
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(Math.round(value))
const money = (value: number) => value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(2)} tỷ` : `${Math.round(value / 1_000_000)} triệu`
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
type SpikeResult = { rows: SpikeEvent[]; total: number; symbols: number }

function MiniChart({ bars, event }: { bars: MinuteBar[]; event: SpikeEvent }) {
  const active = bars.filter(bar => bar.t >= event.start_time && bar.t <= event.end_time)
  const context = bars.filter(bar => {
    const minute = Number(bar.t.slice(0, 2)) * 60 + Number(bar.t.slice(3))
    const start = Number(event.start_time.slice(0, 2)) * 60 + Number(event.start_time.slice(3))
    const end = Number(event.end_time.slice(0, 2)) * 60 + Number(event.end_time.slice(3))
    return minute >= start - 15 && minute <= end + 15
  })
  if (!context.length) return <p className="spike-empty">Chưa có nến phút để hiển thị.</p>
  const max = Math.max(...context.map(bar => bar.v), 1)
  return <div className="spike-mini-chart" role="img" aria-label={`Khối lượng phút quanh sự kiện ${event.start_time} đến ${event.end_time}`}>
    {context.map(bar => <div key={bar.t} className={`spike-mini-bar${active.includes(bar) ? ' active' : ''}${bar.c < bar.o ? ' down' : ''}`}
      title={`${bar.t} · ${number(bar.v)} CP · giá ${bar.c.toLocaleString('vi-VN')}`}
      style={{ height: `${Math.max(5, bar.v / max * 100)}%` }} />)}
  </div>
}

export function IntradaySpikeRadar({ date, authenticated, mode }: { date: string; authenticated: boolean; mode: Mode }) {
  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState('ALL')
  const [minRatio, setMinRatio] = useState(3)
  const [session, setSession] = useState('ALL')
  const [exactDate, setExactDate] = useState(date)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const latestDay = useQuery({ queryKey: ['intraday-spike-latest-day', date], enabled: authenticated && Boolean(supabase) && Boolean(date) && mode === 'screener',
    queryFn: async () => { const { data, error } = await supabase!.from('intraday_spike_events').select('trading_date').lte('trading_date', date).order('trading_date', { ascending: false }).limit(1).maybeSingle(); if (error) throw error; return data?.trading_date as string | undefined }, staleTime: 300_000 })
  useEffect(() => { if (mode === 'screener' && latestDay.data) setExactDate(latestDay.data) }, [mode, latestDay.data])
  const effectiveDate = mode === 'market' ? date : exactDate
  const coverageDate = effectiveDate || latestDay.data || date
  const events = useQuery({ queryKey: ['intraday-spikes', mode, effectiveDate, fromDate, toDate, query, session, direction, minRatio, page, pageSize],
    enabled: authenticated && Boolean(supabase) && Boolean(date) && (mode === 'market' || !latestDay.isLoading),
    queryFn: async (): Promise<SpikeResult> => {
      const { data, error } = await supabase!.rpc('intraday_spike_history', {
        p_exact_date: effectiveDate || null, p_from_date: mode === 'screener' ? fromDate || null : null,
        p_to_date: mode === 'screener' ? toDate || null : null, p_symbol: query.trim(),
        p_session: session, p_direction: direction, p_min_ratio: minRatio,
        p_page: mode === 'market' ? 1 : page, p_page_size: mode === 'market' ? 100 : pageSize,
      })
      if (error) throw error
      return data as SpikeResult
    }, staleTime: 300_000 })
  const coverage = useQuery({ queryKey: ['intraday-spike-coverage', coverageDate], enabled: authenticated && Boolean(supabase) && Boolean(coverageDate),
    queryFn: async () => {
      const { data, error } = await supabase!.from('intraday_minute_days').select('symbol_id,coverage_status,bar_count').eq('trading_date', coverageDate).limit(1000)
      if (error) throw error
      return data ?? []
    }, staleTime: 300_000 })
  const selected = (events.data?.rows ?? []).find(event => event.id === selectedId) ?? null
  const minuteDay = useQuery({ queryKey: ['intraday-spike-minute-day', selected?.symbol_id, selected?.trading_date],
    enabled: authenticated && Boolean(supabase) && Boolean(selected), queryFn: async (): Promise<MinuteDay | null> => {
      const { data, error } = await supabase!.from('intraday_minute_days').select('bars,coverage_status,bar_count,minute_volume,daily_volume')
        .eq('symbol_id', selected!.symbol_id).eq('trading_date', selected!.trading_date).maybeSingle()
      if (error) throw error
      return data as MinuteDay | null
    }, staleTime: 300_000 })
  const filtered = events.data?.rows ?? []
  const displayed = useMemo(() => {
    if (mode === 'screener') return filtered
    const symbols = new Set<number>()
    return filtered.filter(event => {
      if (symbols.has(event.symbol_id)) return false
      symbols.add(event.symbol_id)
      return true
    }).slice(0, 12)
  }, [filtered, mode])
  const completed = coverage.data?.filter(row => row.coverage_status === 'COMPLETE').length ?? 0
  const observed = coverage.data?.length ?? 0
  const ready = Boolean(events.data) && !coverage.isLoading && (mode === 'market' || !latestDay.isLoading)
  const uniqueSymbols = events.data?.symbols ?? 0
  function resetPage() { setPage(1); setSelectedId(null) }
  function chooseExactDate(value: string) { setExactDate(value); setFromDate(''); setToDate(''); resetPage() }
  function chooseRange(setter: (value: string) => void, value: string) { setter(value); setExactDate(''); resetPage() }
  const title = mode === 'market' ? 'Giao dịch đột biến' : 'Lọc giao dịch đột biến'
  return <section className={`panel spike-radar spike-radar-${mode}`} aria-label={title}>
    <div className="spike-head"><div><span className="eyebrow">{mode === 'market' ? '03 · NHỊP GIAO DỊCH' : 'RADAR EOD · NẾN 1 PHÚT'}</span><h2><Waves size={22}/>{title}</h2>
      <p>Nhận diện cụm thanh khoản bất thường trong 1–15 phút, so với cùng thời điểm của các phiên trước.</p></div>
      <div className="spike-date"><Clock3 size={15}/> {effectiveDate ? formatDate(effectiveDate) : 'Toàn bộ lịch sử'}</div></div>
    <div className="spike-metrics"><div><Activity size={18}/><span>Mã có sự kiện</span><strong>{uniqueSymbols}</strong></div>
      <div><Waves size={18}/><span>Sự kiện ghi nhận</span><strong>{events.data?.total ?? 0}</strong></div>
      <div><Database size={18}/><span>Độ phủ phút · {formatDate(coverageDate)}</span><strong>{completed}/{observed || '—'}</strong></div></div>
    <div className="spike-controls"><label className="spike-search"><Search size={16}/><input type="search" aria-label="Tìm mã giao dịch đột biến" placeholder="Tìm mã…" value={query} onChange={event => { setQuery(event.target.value); resetPage() }}/></label>
      {mode === 'screener' && <DateField label="Ngày giao dịch" value={exactDate} onChange={chooseExactDate}/>}
      <label>Phiên<SoftSelect aria-label="Lọc phiên giao dịch" value={session} onChange={event => { setSession(event.target.value); resetPage() }}><option value="ALL">Cả ngày</option><option value="AM">Phiên sáng</option><option value="PM">Phiên chiều</option></SoftSelect></label>
      <label>Diễn biến<SoftSelect aria-label="Lọc diễn biến giao dịch" value={direction} onChange={event => { setDirection(event.target.value); resetPage() }}><option value="ALL">Tất cả</option>{Object.entries(directionName).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</SoftSelect></label>
      <label>Mức đột biến<SoftSelect aria-label="Lọc mức đột biến" value={minRatio} onChange={event => { setMinRatio(Number(event.target.value)); resetPage() }}><option value="3">Từ 3×</option><option value="5">Từ 5×</option><option value="10">Từ 10×</option></SoftSelect></label>
      {mode === 'screener' && <button type="button" className="spike-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>Bộ lọc nâng cao</button>}</div>
    {mode === 'screener' && advancedOpen && <div className="spike-advanced"><DateField label="Từ ngày" value={fromDate} onChange={value => chooseRange(setFromDate, value)}/><DateField label="Đến ngày" value={toDate} onChange={value => chooseRange(setToDate, value)}/><button type="button" onClick={() => { setExactDate(''); setFromDate(''); setToDate(''); resetPage() }}>Toàn bộ lịch sử</button><button type="button" onClick={() => { setQuery(''); setSession('ALL'); setDirection('ALL'); setMinRatio(3); chooseExactDate(latestDay.data || date) }}>Xóa bộ lọc</button></div>}
    {fromDate && toDate && fromDate > toDate && <p className="spike-error" role="alert">Từ ngày phải trước hoặc bằng đến ngày.</p>}
    {(events.isError || coverage.isError) && <p className="spike-error" role="alert">Không tải được Radar giao dịch. <button type="button" onClick={() => { void events.refetch(); void coverage.refetch() }}>Thử lại</button></p>}
    {!ready && !events.isError && <p className="spike-empty">Đang tải dữ liệu giao dịch phút…</p>}
    {mode === 'screener' && ready && !events.isError && <p className="spike-result-count">{events.data?.total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, events.data.total)} / ${events.data.total} sự kiện` : '0 sự kiện'}</p>}
    {ready && !events.isError && <div className="spike-list">
      {mode === 'screener' && displayed.length > 0 && <div className="spike-list-head"><span>Mã</span><span>Khoảng giao dịch</span><span>Đột biến · khối lượng</span><span>Diễn biến giá</span><span/></div>}
      {displayed.map(event => {
        const active = selectedId === event.id
        return <article className={`spike-item ${event.direction.toLowerCase()}${active ? ' selected' : ''}`} key={event.id}>
          <button type="button" className="spike-item-main" aria-expanded={active} onClick={() => setSelectedId(active ? null : event.id)}>
            <span className="spike-symbol"><strong>{event.symbol}</strong><small>{event.sector || event.exchange || 'Cổ phiếu'}</small></span>
            <span className="spike-clock"><b>{event.start_time}–{event.end_time}</b><small>{mode === 'screener' ? `${formatDate(event.trading_date)} · ` : ''}{event.duration_minutes} phút</small></span>
            <span className="spike-volume"><strong>{Number(event.volume_ratio).toFixed(1)}×</strong><small>{money(Number(event.value_vnd))} · {number(event.volume)} CP</small></span>
            <span className={`spike-direction ${event.direction.toLowerCase()}`}><b>{directionName[event.direction]}</b><small>{signed(Number(event.price_change_pct))}</small></span>
            <ArrowUpRight size={18} className="spike-chevron"/></button>
          {active && <div className="spike-detail"><div><h3>Diễn biến quanh sự kiện</h3><p>Khối lượng gấp {Number(event.volume_ratio).toFixed(1)} lần mức điển hình của cùng khoảng phút trong {event.baseline_sessions} phiên đủ dữ liệu.</p>
              {minuteDay.isLoading ? <p>Đang tải biểu đồ phút…</p> : minuteDay.data?.bars?.length ? <MiniChart bars={minuteDay.data.bars} event={event}/> : <p>Dữ liệu phút đã hết thời hạn lưu; log sự kiện vẫn còn.</p>}
              <small>{event.close_hold_pct == null ? 'Giá biến động ít trong cụm giao dịch.' : `Biến động từ đầu sự kiện đến đóng cửa bằng ${Number(event.close_hold_pct).toFixed(0)}% biến động trong sự kiện.`} Nguồn {event.source ?? 'KBS'} · nghiên cứu EOD.</small></div>
              <a href="#analysis" onClick={() => { const symbol = event.symbol; localStorage.setItem('protstock-symbol', symbol); dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol })) }}>Xem phân tích mã <ArrowUpRight size={15}/></a></div>}
        </article>
      })}
      {!filtered.length && <p className="spike-empty">{observed === 0 && mode === 'market' ? 'Chưa có dữ liệu phút cho phiên này. Radar sẽ xuất hiện sau lượt thu thập EOD.' : 'Không có sự kiện khớp bộ lọc và ngưỡng dữ liệu hiện tại.'}</p>}
    </div>}
    {mode === 'screener' && ready && !events.isError && (events.data?.total ?? 0) > 0 && <ResearchPagination label="Phân trang giao dịch đột biến" page={page} pageSize={pageSize} total={events.data?.total ?? 0} onPage={value => { setPage(value); setSelectedId(null) }} onPageSize={value => { setPageSize(value); resetPage() }}/>}
    {mode === 'market' && ready && (events.data?.total ?? 0) > 12 && <a className="spike-more" href="#screener?tab=spikes">Xem toàn bộ trong Bộ lọc tín hiệu <ArrowUpRight size={15}/></a>}
    <p className="spike-note">“Đột biến” mô tả khối lượng khớp trong khoảng phút; hướng giá là diễn biến quan sát được, không xác định danh tính hay bên đặt lệnh. Phiên có dữ liệu thiếu không được chấm sự kiện.</p>
  </section>
}
