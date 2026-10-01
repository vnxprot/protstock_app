import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './MacdWatchPanel.css'

type Row = { symbol_id: number; macd: number | null; macd_signal: number | null; symbols: { symbol: string; sector: string } | { symbol: string; sector: string }[] | null }

export function MacdWatchPanel({ date, authenticated }: { date: string; authenticated: boolean }) {
  const [filter, setFilter] = useState('ALL')
  const [symbol, setSymbol] = useState('')
  const query = useQuery({
    queryKey: ['macd-watch', date], enabled: authenticated && Boolean(supabase), staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('technical_snapshots')
        .select('symbol_id,macd,macd_signal,symbols!inner(symbol,sector,active)')
        .eq('timeframe', 'D').eq('as_of_date', date).eq('symbols.active', true).limit(1000)
      if (error) throw error
      return data as Row[]
    },
  })
  const rows = useMemo(() => (query.data ?? []).flatMap(row => {
    if (row.macd == null || row.macd_signal == null) return []
    const stock = Array.isArray(row.symbols) ? row.symbols[0] : row.symbols
    return stock ? [{ symbol: stock.symbol, sector: stock.sector, macd: Number(row.macd), signal: Number(row.macd_signal), histogram: Number(row.macd) - Number(row.macd_signal) }] : []
  }).filter(row => row.symbol.includes(symbol.trim().toUpperCase()) && (filter === 'ALL' || filter === 'ABOVE' && row.histogram > 0 || filter === 'BELOW' && row.histogram < 0)).sort((a, b) => a.symbol.localeCompare(b.symbol)), [query.data, filter, symbol])
  return <article className="panel macd-watch-panel"><div className="panel-title"><div><h3>WATCH · MACD</h3><small>MACD 12/26/9 khung ngày · {date} · dữ liệu EOD, không chấm tỷ lệ thắng</small></div><span>{rows.length} mã</span></div>
    <div className="macd-watch-tools"><input aria-label="Tìm mã MACD" placeholder="Tìm mã…" value={symbol} onChange={event => setSymbol(event.target.value)}/><select aria-label="Lọc trạng thái MACD" value={filter} onChange={event => setFilter(event.target.value)}><option value="ALL">Tất cả</option><option value="ABOVE">Trên Signal</option><option value="BELOW">Dưới Signal</option></select></div>
    {query.isLoading && <p className="muted">Đang tải MACD…</p>}{query.isError && <p className="form-error">Không tải được dữ liệu MACD.</p>}
    {!query.isLoading && !query.isError && <div className="macd-watch-list">{rows.slice(0, 30).map(row => <div key={row.symbol}><strong>{row.symbol}</strong><span>{row.sector}</span><span className={row.histogram > 0 ? 'positive' : 'negative'}>{row.histogram > 0 ? 'Trên Signal' : 'Dưới Signal'}</span><small>MACD {row.macd.toFixed(3)} · Signal {row.signal.toFixed(3)} · H {row.histogram.toFixed(3)}</small></div>)}{!rows.length && <p className="muted">Không có dữ liệu MACD khớp bộ lọc.</p>}{rows.length > 30 && <p className="muted">Hiển thị 30/{rows.length} mã. Thu hẹp theo mã hoặc trạng thái.</p>}</div>}
  </article>
}
