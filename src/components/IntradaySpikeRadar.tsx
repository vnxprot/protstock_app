import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpRight, Clock3, Database, Search, Waves } from 'lucide-react'
import { formatDate } from '../lib/date'
import { supabase } from '../lib/supabase'
import './intraday-spikes.css'

type Direction = 'UP' | 'DOWN' | 'FLAT' | 'REVERSED_UP' | 'REVERSED_DOWN'
type SpikeEvent = {
  id: number; symbol_id: number; trading_date: string; start_time: string; end_time: string
  duration_minutes: number; volume: number; value_vnd: number; volume_ratio: number
  price_change_pct: number; close_hold_pct: number | null; direction: Direction
  baseline_sessions: number; source: string; symbols?: { symbol: string; sector: string | null; exchange: string | null } | null
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
const daysBefore = (date: string, count: number) => new Date(Date.parse(`${date}T00:00:00Z`) - count * 86400000).toISOString().slice(0, 10)

async function loadEvents(date: string, mode: Mode): Promise<SpikeEvent[]> {
  const { data, error } = await supabase!.from('intraday_spike_events')
    .select('id,symbol_id,trading_date,start_time,end_time,duration_minutes,volume,value_vnd,volume_ratio,price_change_pct,close_hold_pct,direction,baseline_sessions,source,symbols(symbol,sector,exchange)')
    .gte('trading_date', mode === 'market' ? date : daysBefore(date, 14)).lte('trading_date', date)
    .order('trading_date', { ascending: false }).order('volume_ratio', { ascending: false }).limit(1000)
  if (error) throw error
  return (data ?? []) as unknown as SpikeEvent[]
}

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
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const events = useQuery({ queryKey: ['intraday-spikes', date, mode], enabled: authenticated && Boolean(supabase) && Boolean(date),
    queryFn: () => loadEvents(date, mode), staleTime: 300_000 })
  const coverage = useQuery({ queryKey: ['intraday-spike-coverage', date], enabled: authenticated && Boolean(supabase) && Boolean(date),
    queryFn: async () => {
      const { data, error } = await supabase!.from('intraday_minute_days').select('symbol_id,coverage_status,bar_count').eq('trading_date', date).limit(1000)
      if (error) throw error
      return data ?? []
    }, staleTime: 300_000 })
  const selected = (events.data ?? []).find(event => event.id === selectedId) ?? null
  const minuteDay = useQuery({ queryKey: ['intraday-spike-minute-day', selected?.symbol_id, selected?.trading_date],
    enabled: authenticated && Boolean(supabase) && Boolean(selected), queryFn: async (): Promise<MinuteDay | null> => {
      const { data, error } = await supabase!.from('intraday_minute_days').select('bars,coverage_status,bar_count,minute_volume,daily_volume')
        .eq('symbol_id', selected!.symbol_id).eq('trading_date', selected!.trading_date).maybeSingle()
      if (error) throw error
      return data as MinuteDay | null
    }, staleTime: 300_000 })
  const filtered = useMemo(() => (events.data ?? []).filter(event => {
    const symbol = event.symbols?.symbol ?? ''
    return symbol.toUpperCase().includes(query.trim().toUpperCase()) && Number(event.volume_ratio) >= minRatio
      && (direction === 'ALL' || event.direction === direction)
  }), [events.data, query, direction, minRatio])
  const displayed = useMemo(() => {
    if (mode === 'screener') return filtered.slice(0, 100)
    const symbols = new Set<number>()
    return filtered.filter(event => {
      if (symbols.has(event.symbol_id)) return false
      symbols.add(event.symbol_id)
      return true
    }).slice(0, 12)
  }, [filtered, mode])
  const completed = coverage.data?.filter(row => row.coverage_status === 'COMPLETE').length ?? 0
  const observed = coverage.data?.length ?? 0
  const uniqueSymbols = new Set((events.data ?? []).filter(event => event.trading_date === date).map(event => event.symbol_id)).size
  const title = mode === 'market' ? 'Giao dịch đột biến' : 'Lọc giao dịch đột biến'
  return <section className={`panel spike-radar spike-radar-${mode}`} aria-label={title}>
    <div className="spike-head"><div><span className="eyebrow">{mode === 'market' ? '03 · NHỊP GIAO DỊCH' : 'RADAR EOD · NẾN 1 PHÚT'}</span><h2><Waves size={22}/>{title}</h2>
      <p>Nhận diện cụm thanh khoản bất thường trong 1–15 phút, so với cùng thời điểm của các phiên trước.</p></div>
      <div className="spike-date"><Clock3 size={15}/> Đến {formatDate(date)}</div></div>
    <div className="spike-metrics"><div><Activity size={18}/><span>Mã có sự kiện</span><strong>{uniqueSymbols}</strong></div>
      <div><Waves size={18}/><span>Sự kiện ghi nhận</span><strong>{(events.data ?? []).filter(event => event.trading_date === date).length}</strong></div>
      <div><Database size={18}/><span>Dữ liệu phút đủ đối chiếu</span><strong>{completed}/{observed || '—'}</strong></div></div>
    <div className="spike-controls"><label className="spike-search"><Search size={16}/><input type="search" aria-label="Tìm mã giao dịch đột biến" placeholder="Tìm mã…" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <label>Diễn biến<select aria-label="Lọc diễn biến giao dịch" value={direction} onChange={event => setDirection(event.target.value)}><option value="ALL">Tất cả</option>{Object.entries(directionName).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label>Mức đột biến<select aria-label="Lọc mức đột biến" value={minRatio} onChange={event => setMinRatio(Number(event.target.value))}><option value="3">Từ 3×</option><option value="5">Từ 5×</option><option value="10">Từ 10×</option></select></label></div>
    {(events.isError || coverage.isError) && <p className="spike-error" role="alert">Không tải được Radar giao dịch. <button type="button" onClick={() => { void events.refetch(); void coverage.refetch() }}>Thử lại</button></p>}
    {(events.isLoading || coverage.isLoading) && <p className="spike-empty">Đang tải dữ liệu giao dịch phút…</p>}
    {!events.isLoading && !events.isError && <div className="spike-list">
      {displayed.map(event => {
        const active = selectedId === event.id
        return <article className={`spike-item ${event.direction.toLowerCase()}${active ? ' selected' : ''}`} key={event.id}>
          <button type="button" className="spike-item-main" aria-expanded={active} onClick={() => setSelectedId(active ? null : event.id)}>
            <span className="spike-symbol"><strong>{event.symbols?.symbol ?? '—'}</strong><small>{event.symbols?.sector || event.symbols?.exchange || 'Cổ phiếu'}</small></span>
            <span className="spike-clock">{mode === 'screener' && <small>{formatDate(event.trading_date)}</small>}<b>{event.start_time}–{event.end_time}</b><small>{event.duration_minutes} phút</small></span>
            <span className="spike-volume"><strong>{Number(event.volume_ratio).toFixed(1)}×</strong><small>{money(Number(event.value_vnd))} · {number(event.volume)} CP</small></span>
            <span className={`spike-direction ${event.direction.toLowerCase()}`}><b>{directionName[event.direction]}</b><small>{signed(Number(event.price_change_pct))}</small></span>
            <ArrowUpRight size={18} className="spike-chevron"/></button>
          {active && <div className="spike-detail"><div><h3>Diễn biến quanh sự kiện</h3><p>Khối lượng gấp {Number(event.volume_ratio).toFixed(1)} lần mức điển hình của cùng khoảng phút trong {event.baseline_sessions} phiên đủ dữ liệu.</p>
              {minuteDay.isLoading ? <p>Đang tải biểu đồ phút…</p> : minuteDay.data?.bars?.length ? <MiniChart bars={minuteDay.data.bars} event={event}/> : <p>Chưa có biểu đồ phút.</p>}
              <small>{event.close_hold_pct == null ? 'Giá biến động ít trong cụm giao dịch.' : `Biến động từ đầu sự kiện đến đóng cửa bằng ${Number(event.close_hold_pct).toFixed(0)}% biến động trong sự kiện.`} Nguồn {event.source ?? 'KBS'} · nghiên cứu EOD.</small></div>
              <a href="#analysis" onClick={() => { const symbol = event.symbols?.symbol ?? ''; localStorage.setItem('protstock-symbol', symbol); dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol })) }}>Xem phân tích mã <ArrowUpRight size={15}/></a></div>}
        </article>
      })}
      {!filtered.length && !events.isLoading && !events.isError && <p className="spike-empty">{observed === 0 ? 'Chưa có dữ liệu phút cho phiên này. Radar sẽ xuất hiện sau lượt thu thập EOD.' : 'Không có sự kiện khớp bộ lọc và ngưỡng dữ liệu hiện tại.'}</p>}
    </div>}
    {mode === 'market' && filtered.length > 12 && <a className="spike-more" href="#screener?tab=spikes">Xem toàn bộ trong Bộ lọc tín hiệu <ArrowUpRight size={15}/></a>}
    <p className="spike-note">“Đột biến” mô tả khối lượng khớp trong khoảng phút; hướng giá là diễn biến quan sát được, không xác định danh tính hay bên đặt lệnh. Phiên có dữ liệu thiếu không được chấm sự kiện.</p>
  </section>
}
