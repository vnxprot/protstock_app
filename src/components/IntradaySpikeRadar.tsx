import { useOpportunityRoute } from '../lib/opportunities'
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
type RadarSession = { status: 'PROCESSING' | 'INCOMPLETE' | 'PUBLISHED' | 'FAILED'; attempt_count: number;
  expected_symbols: number; complete_symbols: number; baseline_ready_symbols: number;
  source_errors: { symbol: string; status: string; error: string | null }[] }
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
  const route = useOpportunityRoute()
  const [query, setQuery] = useState(route.symbol)
  const [direction, setDirection] = useState('ALL')
  const [minRatio, setMinRatio] = useState(3)
  const [session, setSession] = useState('ALL')
  const [exactDate, setExactDate] = useState(route.date || date)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selectedId, setSelectedId] = useState<number | null>(()=>{const id=Number(new URLSearchParams(location.hash.split('?')[1]??'').get('event'));return Number.isSafeInteger(id)&&id>0?id:null})
  useEffect(() => { if (mode === 'screener') {setExactDate(route.date || date);setQuery(route.symbol);const id=Number(new URLSearchParams(location.hash.split('?')[1]??'').get('event'));setSelectedId(Number.isSafeInteger(id)&&id>0?id:null)} }, [date, mode, route.date, route.symbol])
  const effectiveDate = mode === 'market' ? date : exactDate
  const coverageDate = effectiveDate || date
  const radarSession = useQuery({ queryKey: ['intraday-radar-session', coverageDate], enabled: authenticated && Boolean(supabase) && Boolean(coverageDate),
    queryFn: async (): Promise<RadarSession | null> => {
      const { data, error } = await supabase!.from('intraday_radar_sessions')
        .select('status,attempt_count,expected_symbols,complete_symbols,baseline_ready_symbols,source_errors')
        .eq('trading_date', coverageDate).maybeSingle()
      if (error) throw error
      return data as RadarSession | null
    }, refetchInterval: 60_000 })
  const events = useQuery({ queryKey: ['intraday-spikes', mode, effectiveDate, fromDate, toDate, query, session, direction, minRatio, page, pageSize, radarSession.data?.status],
    enabled: authenticated && Boolean(supabase) && Boolean(date),
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
  const completed = radarSession.data?.complete_symbols ?? 0
  const baselineReady = radarSession.data?.baseline_ready_symbols ?? 0
  const observed = radarSession.data?.expected_symbols ?? 0
  const ready = Boolean(events.data) && !radarSession.isLoading
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
      {mode === 'screener' && advancedOpen && <div className="spike-advanced"><DateField label="Từ ngày" value={fromDate} onChange={value => chooseRange(setFromDate, value)}/><DateField label="Đến ngày" value={toDate} onChange={value => chooseRange(setToDate, value)}/><button type="button" onClick={() => { setExactDate(''); setFromDate(''); setToDate(''); resetPage() }}>Toàn bộ lịch sử</button><button type="button" onClick={() => { setQuery(''); setSession('ALL'); setDirection('ALL'); setMinRatio(3); chooseExactDate(date) }}>Xóa bộ lọc</button></div>}
    {fromDate && toDate && fromDate > toDate && <p className="spike-error" role="alert">Từ ngày phải trước hoặc bằng đến ngày.</p>}
    {(events.isError || radarSession.isError) && <p className="spike-error" role="alert">Không tải được Radar giao dịch. <button type="button" onClick={() => { void events.refetch(); void radarSession.refetch() }}>Thử lại</button></p>}
    {!ready && !events.isError && <p className="spike-empty">Đang tải dữ liệu giao dịch phút…</p>}
    {ready && <p className="spike-result-count" role="status">{radarSession.data?.status === 'PUBLISHED'
      ? `Phiên ${formatDate(coverageDate)} đã công bố · ${completed}/${observed} mã đủ nến phút · ${baselineReady} mã có ít nhất 10 phiên mốc.`
      : radarSession.data?.status === 'PROCESSING'
        ? `Đang xử lý phiên ${formatDate(coverageDate)} · ${completed}/${observed} mã đủ nến phút · ${baselineReady} mã đủ phiên mốc · lượt ${radarSession.data.attempt_count}/3.`
        : radarSession.data?.status === 'FAILED'
          ? `Xử lý phiên ${formatDate(coverageDate)} thất bại · lượt ${radarSession.data.attempt_count}/3. ${radarSession.data.attempt_count < 3 ? 'Hệ thống sẽ thử phục hồi lỗi kỹ thuật.' : 'Đã hết lượt tự phục hồi, cần xử lý.'}`
        : radarSession.data?.status === 'INCOMPLETE'
          ? `Thiếu dữ liệu phiên ${formatDate(coverageDate)} · ${completed}/${observed} mã đủ nến phút · ${baselineReady} mã đủ phiên mốc · lượt ${radarSession.data.attempt_count}/3.`
          : `Phiên ${formatDate(coverageDate)} chưa được khởi tạo Radar; đang chờ EOD hoặc hệ thống phục hồi. Chưa thể kết luận có giao dịch đột biến hay không.`}
      {radarSession.data?.source_errors?.length ? ` Lỗi/thiếu nguồn: ${radarSession.data.source_errors.slice(0, 3).map(item => `${item.symbol} (${item.error || item.status})`).join('; ')}${radarSession.data.source_errors.length > 3 ? '…' : ''}` : ''}</p>}
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
              <small>{event.close_hold_pct == null ? 'Giá biến động ít trong cụm giao dịch.' : `Biến động từ đầu sự kiện đến đóng cửa bằng ${Number(event.close_hold_pct).toFixed(0)}% biến động trong sự kiện.`} Nguồn {event.source ?? 'VCI'} · nghiên cứu EOD.</small></div>
              <a href="#analysis" onClick={() => { const symbol = event.symbol; localStorage.setItem('protstock-symbol', symbol); dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol })) }}>Xem phân tích mã <ArrowUpRight size={15}/></a></div>}
        </article>
      })}
      {!filtered.length && <p className="spike-empty">{radarSession.data?.status === 'PUBLISHED' ? 'Không có sự kiện khớp bộ lọc và ngưỡng dữ liệu hiện tại.' : 'Phiên chưa công bố dữ liệu. Danh sách trống không có nghĩa là không phát sinh giao dịch đột biến.'}</p>}
    </div>}
    {mode === 'screener' && ready && !events.isError && (events.data?.total ?? 0) > 0 && <ResearchPagination label="Phân trang giao dịch đột biến" page={page} pageSize={pageSize} total={events.data?.total ?? 0} onPage={value => { setPage(value); setSelectedId(null) }} onPageSize={value => { setPageSize(value); resetPage() }}/>}
    {mode === 'market' && ready && (events.data?.total ?? 0) > 12 && <a className="spike-more" href="#screener?tab=spikes">Xem toàn bộ trong Bộ lọc tín hiệu <ArrowUpRight size={15}/></a>}
    <p className="spike-note">“Đột biến” mô tả khối lượng khớp trong khoảng phút; hướng giá là diễn biến quan sát được, không xác định danh tính hay bên đặt lệnh. Phiên có dữ liệu thiếu không được chấm sự kiện.</p>
  </section>
}
