import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'
import { DateField } from './DateField'

const labels: Record<string, string> = { BUY_NEW: 'Mua mới', BUY_ADD: 'Mua thêm', SELL_REDUCE: 'Bán giảm', SELL_CLOSE: 'Đóng vị thế', STOP_UPDATE: 'Điều chỉnh stop' }

export type PortfolioTransaction = { id: string; symbol_id: string; trading_date: string; action: string; quantity: number; price: number | null; stop_price: number | null; note: string | null; symbols: { symbol: string; sector?: string | null } | null }

type RealizedSlice = { costBasis: number; pnl: number; returnPct: number; openedAt: string }

function realizedSlices(rows: PortfolioTransaction[]) {
  const lots: Record<string, { quantity: number; cost: number; openedAt: string }[]> = {}
  const results: Record<string, RealizedSlice> = {}
  for (const item of [...rows].reverse()) {
    const key = String(item.symbol_id)
    const quantity = Number(item.quantity ?? 0)
    const price = Number(item.price ?? 0)
    if (!lots[key]) lots[key] = []
    if (['BUY_NEW', 'BUY_ADD'].includes(item.action) && quantity > 0 && price > 0) { lots[key].push({ quantity, cost: price, openedAt: item.trading_date }); continue }
    if (!['SELL_REDUCE', 'SELL_CLOSE'].includes(item.action) || quantity <= 0 || price <= 0) continue
    let remaining = quantity; let costBasis = 0; let openedAt = item.trading_date
    while (remaining > 0 && lots[key].length) { const lot = lots[key][0]; const used = Math.min(remaining, lot.quantity); costBasis += used * lot.cost; openedAt = lot.openedAt; lot.quantity -= used; remaining -= used; if (lot.quantity <= 0) lots[key].shift() }
    const matched = quantity - remaining
    if (matched > 0 && costBasis > 0) { const pnl = matched * price - costBasis; results[item.id] = { costBasis, pnl, returnPct: pnl / costBasis * 100, openedAt } }
  }
  return results
}

export function PortfolioTransactions({ authenticated, onEdit, onDelete }: { authenticated: boolean; onEdit: (item: PortfolioTransaction) => void; onDelete: (item: PortfolioTransaction) => void }) {
  const [symbolFilter, setSymbolFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [actionFilter, setActionFilter] = useState('ALL')
  const transactions = useQuery({ queryKey: ['portfolio-transactions'], enabled: authenticated && Boolean(supabase), queryFn: async () => {
    const { data, error } = await supabase!.from('portfolio_transactions').select('id,symbol_id,trading_date,action,quantity,price,stop_price,note,symbols(symbol,sector)').order('trading_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    return (data ?? []).map((item: any) => ({ ...item, symbols: Array.isArray(item.symbols) ? item.symbols[0] ?? null : item.symbols })) as PortfolioTransaction[]
  } })
  const rows = transactions.data ?? []
  const realizedById = useMemo(() => realizedSlices(rows), [rows])
  const filteredRows = useMemo(() => { const query = symbolFilter.trim().toUpperCase(); return rows.filter(item => (!query || (item.symbols?.symbol ?? '').toUpperCase().includes(query)) && (!fromDate || item.trading_date >= fromDate) && (!toDate || item.trading_date <= toDate) && (actionFilter === 'ALL' || item.action === actionFilter)) }, [rows, symbolFilter, fromDate, toDate, actionFilter])
  const hasFilters = Boolean(symbolFilter || fromDate || toDate || actionFilter !== 'ALL')
  const clearFilters = () => { setSymbolFilter(''); setFromDate(''); setToDate(''); setActionFilter('ALL') }
  return <article className="panel transaction-history"><div className="panel-title"><h3>Lịch sử giao dịch</h3><span>{hasFilters ? `${filteredRows.length}/${rows.length} giao dịch` : `${rows.length} giao dịch`}</span></div><div className="transaction-filters" aria-label="Lọc lịch sử giao dịch"><label><span>Mã cổ phiếu</span><input value={symbolFilter} onChange={event => setSymbolFilter(event.target.value)} /></label><DateField label="Từ ngày" value={fromDate} onChange={setFromDate}/><DateField label="Đến ngày" value={toDate} onChange={setToDate}/><label><span>Hoạt động</span><select value={actionFilter} onChange={event => setActionFilter(event.target.value)}><option value="ALL">Tất cả hoạt động</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{hasFilters && <button type="button" className="transaction-filter-clear" onClick={clearFilters}>Xóa lọc</button>}</div>{transactions.isLoading ? <p className="muted">Đang tải giao dịch…</p> : filteredRows.length ? <div className="transaction-list">{filteredRows.map(item => { const realized = realizedById[item.id]; return <div className="transaction-row" key={item.id}><div><strong>{item.symbols?.symbol ?? '—'} · {labels[item.action] ?? item.action}</strong><small>{formatDate(item.trading_date)} · {item.quantity ? `${Number(item.quantity).toLocaleString('vi-VN')} CP` : 'Cập nhật stop'}{item.price ? ` · ${formatVnd(Number(item.price))}` : ''}</small>{realized && <span className={`transaction-realized ${realized.pnl < 0 ? 'negative' : 'positive'}`}><b>{item.action === 'SELL_CLOSE' ? 'P/L vị thế' : 'P/L phần bán'} {realized.pnl >= 0 ? '+' : ''}{formatVnd(realized.pnl)}</b><small>{realized.returnPct >= 0 ? '+' : ''}{realized.returnPct.toFixed(2)}% · mua từ {formatDate(realized.openedAt)}</small></span>}{item.note && <p>{item.note}</p>}</div><div className="transaction-actions"><button type="button" aria-label="Chỉnh sửa giao dịch" onClick={() => onEdit(item)}><Pencil size={15}/> Sửa</button><button type="button" className="danger" aria-label="Xoá giao dịch" onClick={() => onDelete(item)}><Trash2 size={15}/> Xoá</button></div></div> })}</div> : <p className="muted">{hasFilters ? 'Không có giao dịch khớp bộ lọc.' : 'Chưa có giao dịch nào.'}</p>}</article>
}
