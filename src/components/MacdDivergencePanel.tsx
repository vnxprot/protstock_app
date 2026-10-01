import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './MacdDivergencePanel.css'

type Pivot = { date: string; price_low: number; oscillator: number }
type Row = { symbol: string; oscillator: string; swings: number; stage: string;
  confirmed_on: string; trigger_price: number; invalidation_price: number;
  trigger_date: string | null; version: string; evidence: { pivots?: Pivot[] } }

const stages: Record<string, string> = {
  WATCH_PRICE_CONFIRMATION: 'Chờ giá xác nhận', CONFIRMED: 'Đã xác nhận',
  INVALIDATED: 'Đã vô hiệu', EXPIRED: 'Hết hạn',
}

export function MacdDivergencePanel({ date, authenticated }: { date: string; authenticated: boolean }) {
  const [stage, setStage] = useState('ACTIVE')
  const [page, setPage] = useState(1)
  const [symbol, setSymbol] = useState('')
  const query = useQuery({
    queryKey: ['macd-divergence-shadow', date], enabled: authenticated && Boolean(supabase),
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase!.from('macd_divergence_assessments')
        .select('oscillator,swings,stage,confirmed_on,trigger_price,invalidation_price,trigger_date,version,evidence,symbols!inner(symbol)')
        .eq('as_of_date', date).order('symbol_id').limit(1000)
      if (error) throw error
      const rows = (data ?? []).map((item: any): Row => ({ ...item,
        symbol: (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol ?? '—' }))
      const byKey = new Map<string, Row>()
      for (const row of rows) {
        const key = `${row.symbol}:${row.oscillator}`
        if (!byKey.has(key) || row.version.endsWith('_KBS_REBASED')) byKey.set(key, row)
      }
      return [...byKey.values()]
    },
  })
  const rows = query.data ?? []
  const filtered = useMemo(() => rows.filter(row =>
    (stage === 'ALL' || stage === 'ACTIVE' && (Boolean(symbol.trim()) || ['WATCH_PRICE_CONFIRMATION', 'CONFIRMED'].includes(row.stage)) || row.stage === stage)
    && row.symbol.includes(symbol.trim().toUpperCase())), [rows, stage, symbol])
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const current = Math.min(page, pages)
  return <article className="panel macd-divergence-panel">
    <div className="panel-title"><div><h3>Phân kỳ dương giá–MACD</h3><p className="muted">Bản nghiên cứu · hai/ba đáy đã đóng · không tự tạo lệnh mua</p></div><span>{date}</span></div>
    <div className="macd-divergence-tools"><input aria-label="Tìm mã phân kỳ MACD" placeholder="Tìm mã…" value={symbol} onChange={event => { setSymbol(event.target.value); setPage(1) }}/>
      <select aria-label="Trạng thái phân kỳ MACD" value={stage} onChange={event => { setStage(event.target.value); setPage(1) }}>
        <option value="ACTIVE">Cần theo dõi</option><option value="ALL">Tất cả</option>
        {Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select><span>{filtered.length} mẫu hình</span></div>
    {query.isLoading && <p className="muted">Đang tải nghiên cứu phân kỳ…</p>}
    {query.isError && <p className="muted">Không đọc được nghiên cứu phân kỳ.</p>}
    {!query.isLoading && !query.isError && <div className="macd-divergence-list">
      {filtered.slice((current - 1) * 10, current * 10).map(row => <details key={`${row.symbol}:${row.oscillator}`}>
        <summary><strong>{row.symbol}</strong><span>{row.oscillator === 'MACD_LINE' ? 'Đường MACD' : 'Histogram'} · {row.swings} đáy</span>
          <span>{stages[row.stage] ?? row.stage}</span><small>Xác nhận đáy {row.confirmed_on}</small></summary>
        <p>Cần đóng cửa vượt {row.trigger_price.toLocaleString('vi-VN')} · Vô hiệu dưới {row.invalidation_price.toLocaleString('vi-VN')}{row.trigger_date ? ` · Giá vượt ngày ${row.trigger_date}` : ''}</p>
        <div className="macd-divergence-pivots">{(row.evidence?.pivots ?? []).map(pivot => <span key={pivot.date}>{pivot.date}: đáy {pivot.price_low.toLocaleString('vi-VN')} · chỉ báo {pivot.oscillator.toFixed(3)}</span>)}</div>
        <small>Giá dùng đáy phiên; MACD tính từ giá đóng cửa. Kiểm tra dữ liệu điều chỉnh và bối cảnh trước khi đánh giá.</small>
      </details>)}
      {!filtered.length && <p className="muted">Không có mẫu hình khớp bộ lọc ở phiên này.</p>}
    </div>}
    {filtered.length > 10 && <nav className="signal-funnel-pagination" aria-label="Phân trang phân kỳ MACD"><span>Trang {current}/{pages}</span><div><button type="button" disabled={current <= 1} onClick={() => setPage(value => value - 1)}>Trước</button><button type="button" disabled={current >= pages} onClick={() => setPage(value => value + 1)}>Sau</button></div></nav>}
  </article>
}
