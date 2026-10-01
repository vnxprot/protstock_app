import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './MacdDivergencePanel.css'

type Pivot = { date: string; price_low: number; oscillator: number }
type Row = { symbol: string; oscillator: string; swings: number; stage: string;
  confirmed_on: string; trigger_price: number; invalidation_price: number;
  trigger_date: string | null; version: string; evidence: { pivots?: Pivot[]; oscillator_basis?: string } }

const stages: Record<string, string> = {
  WATCH_PRICE_CONFIRMATION: 'Chờ giá xác nhận', CONFIRMED: 'Đã xác nhận',
  INVALIDATED: 'Đã vô hiệu', EXPIRED: 'Hết hạn',
}

export function MacdDivergencePanel({ date, authenticated }: { date: string; authenticated: boolean }) {
  const [stage, setStage] = useState('ACTIVE')
  const [segments, setSegments] = useState(0)
  const [page, setPage] = useState(1)
  const [symbol, setSymbol] = useState('')
  const query = useQuery({
    queryKey: ['macd-divergence-shadow', date], enabled: authenticated && Boolean(supabase),
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase!.from('macd_divergence_assessments')
        .select('oscillator,swings,stage,confirmed_on,trigger_price,invalidation_price,trigger_date,version,evidence,symbols!inner(symbol)')
        .eq('as_of_date', date).eq('symbols.active', true).order('symbol_id').limit(1000)
      if (error) throw error
      const rows = (data ?? []).map((item: any): Row => ({ ...item,
        symbol: (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol ?? '—' }))
      const byKey = new Map<string, Row>()
      for (const row of rows) {
        const key = `${row.symbol}:${row.oscillator}:${row.swings}`
        const previous = byKey.get(key)
        const rank = (item: Row) => (item.version.includes('_V3') ? 4 : item.version.includes('_V2') ? 2 : 0) + (item.version.endsWith('_KBS_REBASED') ? 1 : 0)
        if (!previous || rank(row) > rank(previous)) byKey.set(key, row)
      }
      return [...byKey.values()]
    },
  })
  const rows = query.data ?? []
  const filtered = useMemo(() => rows.filter(row =>
    (stage === 'ALL' || stage === 'ACTIVE' && (Boolean(symbol.trim()) || row.stage === 'WATCH_PRICE_CONFIRMATION' || row.stage === 'CONFIRMED' && row.trigger_date === date) || row.stage === stage)
    && (!segments || row.swings === segments + 1)
    && row.symbol.includes(symbol.trim().toUpperCase())).sort((a, b) =>
      (a.stage === 'CONFIRMED' && a.trigger_date === date ? 0 : a.stage === 'WATCH_PRICE_CONFIRMATION' ? 1 : 2)
      - (b.stage === 'CONFIRMED' && b.trigger_date === date ? 0 : b.stage === 'WATCH_PRICE_CONFIRMATION' ? 1 : 2)
      || b.confirmed_on.localeCompare(a.confirmed_on) || b.swings - a.swings || a.symbol.localeCompare(b.symbol)), [rows, stage, segments, symbol, date])
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const current = Math.min(page, pages)
  return <article className="panel macd-divergence-panel">
    <div className="panel-title"><div><h3>Phân kỳ Dương MACD · 1–3 đoạn</h3><p className="muted">1 đoạn = 2 đáy · 2 đoạn = 3 đáy · 3 đoạn = 4 đáy. Ưu tiên giá vừa xác nhận, rồi mẫu hình đang chờ breakout.</p></div><span>{date}</span></div>
    <div className="macd-divergence-tools"><input aria-label="Tìm mã phân kỳ MACD" placeholder="Tìm mã…" value={symbol} onChange={event => { setSymbol(event.target.value); setPage(1) }}/>
      <select aria-label="Số đoạn phân kỳ MACD" value={segments} onChange={event => { setSegments(Number(event.target.value)); setPage(1) }}><option value={0}>Cả 1–3 đoạn</option><option value={1}>1 đoạn · 2 đáy</option><option value={2}>2 đoạn · 3 đáy</option><option value={3}>3 đoạn · 4 đáy</option></select>
      <select aria-label="Trạng thái phân kỳ MACD" value={stage} onChange={event => { setStage(event.target.value); setPage(1) }}>
        <option value="ACTIVE">Cần theo dõi</option><option value="ALL">Tất cả</option>
        {Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select><span>{filtered.length} mẫu hình</span></div>
    {query.isLoading && <p className="muted">Đang tải nghiên cứu phân kỳ…</p>}
    {query.isError && <p className="muted">Không đọc được nghiên cứu phân kỳ.</p>}
    {!query.isLoading && !query.isError && <div className="macd-divergence-list">
      {filtered.slice((current - 1) * 10, current * 10).map(row => <details key={`${row.symbol}:${row.oscillator}:${row.swings}`}>
        <summary><strong>{row.symbol}</strong><span>{row.swings - 1} đoạn · {row.swings} đáy · {row.oscillator === 'MACD_LINE' ? 'MACD' : 'Histogram'}</span>
          <span>{row.stage === 'CONFIRMED' && row.trigger_date === date ? 'Giá vừa xác nhận' : stages[row.stage] ?? row.stage}</span><small>Đáy xác nhận {row.confirmed_on}</small></summary>
        <p>Cần đóng cửa vượt {row.trigger_price.toLocaleString('vi-VN')} · Vô hiệu dưới {row.invalidation_price.toLocaleString('vi-VN')}{row.trigger_date ? ` · Giá vượt ngày ${row.trigger_date}` : ''}</p>
        <div className="macd-divergence-pivots">{(row.evidence?.pivots ?? []).map(pivot => <span key={pivot.date}>{pivot.date}: đáy {pivot.price_low.toLocaleString('vi-VN')} · chỉ báo {pivot.oscillator.toFixed(3)}{row.evidence?.oscillator_basis === 'MACD_PCT_OF_CLOSE' ? '%' : ''}</span>)}</div>
        <small>Mỗi đoạn: đáy giá thấp hơn, MACD tại cùng ngày đáy cao hơn. Đáy chỉ xác nhận sau 2 phiên; rule phát WATCH khi chờ giá và đề xuất PROBE_BUY khi đóng cửa vượt đỉnh hồi, qua policy chung.</small>
      </details>)}
      {!filtered.length && <p className="muted">Không có mẫu hình khớp bộ lọc ở phiên này.</p>}
    </div>}
    {filtered.length > 10 && <nav className="signal-funnel-pagination" aria-label="Phân trang phân kỳ MACD"><span>Trang {current}/{pages}</span><div><button type="button" disabled={current <= 1} onClick={() => setPage(value => value - 1)}>Trước</button><button type="button" disabled={current >= pages} onClick={() => setPage(value => value + 1)}>Sau</button></div></nav>}
  </article>
}
