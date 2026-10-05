import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Filter, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SoftSelect } from './SoftSelect'
import './MacdDivergencePanel.css'

const VERSION = 'MACD_BULLISH_DIVERGENCE_ZONE_V4'
type Zone = { start_date: string; end_date: string; price_date: string; price_low: number; macd_date: string; macd_low: number; revisions: { date: string; price_low: number }[] }
type Evidence = { zones: Zone[]; strength: 'THIN' | 'ROBUST'; price_declines_pct: number[]; macd_rises_pct_points: number[];
  breakout_volume_ratio20?: number | null; trigger_age_sessions?: number | null; pending_lower_low_on?: string | null;
  invalidated_on?: string | null; latest_close: number; distance_to_trigger_pct: number }
type Row = { symbol_id: number; symbol: string; setup_id: string; swings: number; stage: string; confirmed_on: string;
  trigger_price: number; invalidation_price: number; trigger_date: string | null; evidence: Evidence }

const stages: Record<string, string> = {
  WATCH_PRICE_CONFIRMATION: 'Chờ giá breakout', CONFIRMED: 'Giá đã breakout',
  INVALIDATED: 'Cấu trúc đã hỏng', EXPIRED: 'Hết thời hạn theo dõi',
}
const price = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 3 })
function priority(row: Row, date: string) {
  if (row.stage === 'CONFIRMED' && row.trigger_date === date) return 0
  if (row.stage === 'CONFIRMED') return 1
  if (row.evidence.pending_lower_low_on) return 2
  if (row.confirmed_on === date) return 3
  if (row.stage === 'WATCH_PRICE_CONFIRMATION') return 4
  return 5
}

function ZoneHistory({ row, date, open }: { row: Row; date: string; open: boolean }) {
  const history = useQuery({
    queryKey: ['macd-zone-history', row.symbol_id, row.swings, date],
    enabled: open && Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!.from('macd_divergence_assessments')
        .select('as_of_date,setup_id,stage,trigger_date,evidence')
        .eq('symbol_id', row.symbol_id).eq('version', VERSION).eq('swings', row.swings)
        .lte('as_of_date', date).order('as_of_date', { ascending: false }).limit(120)
      if (error) throw error
      const chronological = [...(data ?? [])].reverse()
      return chronological.filter((item, index) => {
        const previous = chronological[index - 1]
        const last = item.evidence?.zones?.at(-1)?.price_low
        return !previous || item.setup_id !== previous.setup_id || item.stage !== previous.stage
          || last !== previous.evidence?.zones?.at(-1)?.price_low
      }).slice(-8)
    },
  })
  if (!open) return null
  return <div className="macd-zone-history"><strong>Diễn biến ghi nhận theo phiên</strong>
    {history.isLoading ? <p>Đang tải diễn biến…</p> : history.isError ? <p>Chưa đọc được diễn biến.</p>
      : history.data?.length ? <ol>{history.data.map(item => <li key={item.as_of_date + item.setup_id}>
        <time>{item.as_of_date}</time><span>{stages[item.stage] ?? item.stage}
          {item.evidence?.zones?.at(-1)?.price_low != null ? ' · đáy ' + price(item.evidence.zones.at(-1).price_low) : ''}
          {item.trigger_date === item.as_of_date ? ' · breakout' : ''}</span>
      </li>)}</ol> : <p>Chưa có phiên phân kỳ trước đó; từ phiên này hệ thống lưu diễn biến hằng ngày.</p>}</div>
}

function ZoneRow({ row, date }: { row: Row; date: string }) {
  const [open, setOpen] = useState(false)
  const evidence = row.evidence
  const latest = row.stage === 'CONFIRMED' && row.trigger_date === date
  const status = evidence.pending_lower_low_on ? 'Đáy đang cập nhật'
    : latest ? 'Vừa breakout'
    : row.stage === 'CONFIRMED' ? 'Breakout gần đây'
    : row.confirmed_on === date ? 'Vừa phát hiện'
    : stages[row.stage] ?? row.stage
  return <details className={latest ? 'macd-zone-fresh' : ''} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>{row.symbol}</strong><span>{row.swings - 1} đoạn · {row.swings} vùng đáy · đường MACD</span>
      <span>{status}</span><small>{evidence.strength === 'THIN' ? 'Biên mỏng' : 'Biên rõ'}
        {' · '}{row.stage === 'CONFIRMED' ? 'đã vượt' : 'cách ngưỡng'} {Math.abs(evidence.distance_to_trigger_pct).toFixed(1)}%</small></summary>
    <p className="macd-zone-levels">Đóng cửa gần nhất <b>{price(evidence.latest_close)}</b> · Vượt <b>{price(row.trigger_price)}</b> để xác nhận giá · Đáy bảo vệ <b>{price(row.invalidation_price)}</b></p>
    {row.trigger_date && <p>Giá vượt ngày <b>{row.trigger_date}</b>
      {evidence.breakout_volume_ratio20 != null ? ' · khối lượng ' + evidence.breakout_volume_ratio20.toFixed(1) + '× trung bình 20 phiên trước' : ''}.
      {row.trigger_date !== date && ' Đây là sự kiện đã qua; rule không phát lệnh mua muộn.'}</p>}
    {evidence.pending_lower_low_on && <p className="macd-zone-note">Đáy mới ngày {evidence.pending_lower_low_on} đang chờ hai phiên đóng để cập nhật vùng; mẫu vẫn được theo dõi, chưa kích hoạt mua.</p>}
    <div className="macd-zone-chain">{evidence.zones.map((zone, index) => <div key={zone.start_date}>
      <b>Vùng {index + 1}</b><span>{zone.start_date}–{zone.end_date}</span>
      <span>Giá thấp nhất {zone.price_date}: <b>{price(zone.price_low)}</b></span>
      <span>MACD thấp nhất {zone.macd_date}: <b>{zone.macd_low.toFixed(3)}%</b></span>
      {index > 0 && <small>Giá giảm {evidence.price_declines_pct[index - 1].toFixed(2)}% · MACD tăng {evidence.macd_rises_pct_points[index - 1].toFixed(3)} điểm %</small>}
      {zone.revisions.length > 1 && <small>Cập nhật đáy: {zone.revisions.map(item => item.date + ' (' + price(item.price_low) + ')').join(' → ')}</small>}
    </div>)}</div>
    <p className="macd-zone-note">Vùng đáy giá và đáy đường MACD được tìm riêng; ngày có thể lệch nhau. “Biên mỏng” vẫn được theo dõi, nhưng chỉ đề xuất mua khi giá breakout cùng khối lượng xác nhận và qua bộ lọc rủi ro chung. Histogram không tham gia rule này.</p>
    <ZoneHistory row={row} date={date} open={open}/>
  </details>
}

export function MacdDivergencePanel({ date, authenticated }: { date: string; authenticated: boolean }) {
  const [stage, setStage] = useState('ACTIVE')
  const [segments, setSegments] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [symbol, setSymbol] = useState('')
  const query = useQuery({
    queryKey: ['macd-zone-divergence-v4', date], enabled: authenticated && Boolean(supabase), refetchInterval: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const rows: Row[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase!.from('macd_divergence_assessments')
          .select('symbol_id,setup_id,swings,stage,confirmed_on,trigger_price,invalidation_price,trigger_date,evidence,symbols!inner(symbol)')
          .eq('as_of_date', date).eq('version', VERSION).eq('oscillator', 'MACD_LINE')
          .eq('symbols.active', true).order('symbol_id').order('swings').range(from, from + 999)
        if (error) throw error
        rows.push(...(data ?? []).map((item: any) => ({ ...item,
          symbol: (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol ?? '—' })))
        if ((data ?? []).length < 1000) break
      }
      return rows
    },
  })
  const rows = query.data ?? []
  const filtered = useMemo(() => {
    const matches = rows.filter(row => row.symbol.includes(symbol.trim().toUpperCase())
      && (stage === 'ALL' || stage === 'FRESH' && row.stage === 'WATCH_PRICE_CONFIRMATION' && !row.evidence.pending_lower_low_on && row.confirmed_on === date || stage === 'ACTIVE' && (row.stage === 'WATCH_PRICE_CONFIRMATION'
        || row.stage === 'CONFIRMED' && (row.evidence.trigger_age_sessions ?? 999) <= 5)
        || row.stage === stage)
      && (segments <= 0 || row.swings === segments + 1))
      .sort((a, b) => priority(a, date) - priority(b, date)
        || Math.max(0, a.evidence.distance_to_trigger_pct) - Math.max(0, b.evidence.distance_to_trigger_pct)
        || b.swings - a.swings || b.confirmed_on.localeCompare(a.confirmed_on))
    if (segments !== 0) return matches
    const seen = new Set<string>()
    return matches.filter(row => { if (seen.has(row.symbol)) return false; seen.add(row.symbol); return true })
  }, [rows, symbol, stage, segments, date])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  const fresh = rows.filter(row => row.stage === 'CONFIRMED' && row.trigger_date === date).length
  const watching = new Set(rows.filter(row => row.stage === 'WATCH_PRICE_CONFIRMATION').map(row => row.symbol)).size
  return <article className="panel macd-divergence-panel">
    <div className="panel-title"><div><h3>Phân kỳ Dương · đường MACD v1.0</h3>
      <p className="muted">1 đoạn = 2 vùng đáy · 2 đoạn = 3 vùng · 3 đoạn = 4 vùng. Ưu tiên breakout mới và mã gần ngưỡng giá.</p></div><span>{date}</span></div>
    <div className="macd-zone-summary"><span><b>{fresh}</b> mẫu breakout phiên này</span><span><b>{watching}</b> mã đang theo dõi</span><small>Mỗi mã hiển thị mẫu ưu tiên; chọn “Tất cả đoạn” để xem mọi cấu trúc.</small></div>
    <div className="macd-divergence-tools"><label className="screener-field"><Search size={16}/><input aria-label="Tìm mã phân kỳ MACD" placeholder="Tìm mã…" value={symbol} onChange={event => { setSymbol(event.target.value); setPage(1) }}/></label>
      <label className="screener-field"><Filter size={16}/><SoftSelect aria-label="Số đoạn phân kỳ MACD" value={segments} onChange={event => { setSegments(Number(event.target.value)); setPage(1) }}>
        <option value={0}>Mẫu ưu tiên mỗi mã</option><option value={-1}>Tất cả đoạn</option>
        <option value={1}>1 đoạn · 2 vùng</option><option value={2}>2 đoạn · 3 vùng</option><option value={3}>3 đoạn · 4 vùng</option>
      </SoftSelect></label>
      <label className="screener-field"><Filter size={16}/><SoftSelect aria-label="Trạng thái phân kỳ MACD" value={stage} onChange={event => { setStage(event.target.value); setPage(1) }}>
        <option value="ACTIVE">Đang theo dõi và breakout gần đây</option><option value="FRESH">Vừa phát hiện</option>
        {Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        <option value="ALL">Tất cả trạng thái</option>
      </SoftSelect></label><span>{filtered.length} mã/mẫu</span></div>
    {query.isLoading && <p className="muted">Đang tải phân kỳ theo vùng đáy…</p>}
    {query.isError && <p className="muted">Không đọc được dữ liệu phân kỳ.</p>}
    {!query.isLoading && !query.isError && <div className="macd-divergence-list">
      {filtered.slice((current - 1) * pageSize, current * pageSize).map(row => <ZoneRow key={row.symbol + ':' + row.swings} row={row} date={date}/>)}
      {!filtered.length && <p className="muted">Chưa có mẫu hình khớp bộ lọc ở phiên này.</p>}
    </div>}
    <nav className="screener-pagination" aria-label="Phân trang phân kỳ MACD"><span>Hiển thị <SoftSelect aria-label="Số mẫu mỗi trang" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1)}}><option value="25">25</option><option value="50">50</option><option value="100">100</option></SoftSelect> / trang · {filtered.length} mã/mẫu</span><div><button type="button" disabled={current===1} onClick={()=>setPage(1)}>Đầu</button><button type="button" disabled={current===1} onClick={()=>setPage(current-1)}>‹ Trước</button><b>Trang {current}/{pages}</b><button type="button" disabled={current===pages} onClick={()=>setPage(current+1)}>Sau ›</button><button type="button" disabled={current===pages} onClick={()=>setPage(pages)}>Cuối</button></div></nav>
  </article>
}
