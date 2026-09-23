import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'
import { DateField } from './DateField'

const labels: Record<string, string> = { BUY_NEW: 'Mua mới', BUY_ADD: 'Mua thêm', SELL_REDUCE: 'Bán giảm', SELL_CLOSE: 'Đóng vị thế', STOP_UPDATE: 'Điều chỉnh stop' }

export type PortfolioTransaction = { id: string; trading_date: string; action: string; quantity: number; price: number | null; stop_price: number | null; note: string | null; symbols: { symbol: string; sector?: string | null } | null }

export function PortfolioTransactions({ authenticated, onEdit, onDelete }: { authenticated: boolean; onEdit: (item: PortfolioTransaction) => void; onDelete: (item: PortfolioTransaction) => void }) {
  const [symbolFilter, setSymbolFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [actionFilter, setActionFilter] = useState('ALL')
  const transactions = useQuery({ queryKey: ['portfolio-transactions'], enabled: authenticated && Boolean(supabase), queryFn: async () => {
    const { data, error } = await supabase!.from('portfolio_transactions').select('id,trading_date,action,quantity,price,stop_price,note,symbols(symbol,sector)').order('trading_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    return (data ?? []).map((item: any) => ({ ...item, symbols: Array.isArray(item.symbols) ? item.symbols[0] ?? null : item.symbols })) as PortfolioTransaction[]
  } })
  const rows = transactions.data ?? []
  const filteredRows = useMemo(() => { const query = symbolFilter.trim().toUpperCase(); return rows.filter(item => (!query || (item.symbols?.symbol ?? '').toUpperCase().includes(query)) && (!fromDate || item.trading_date >= fromDate) && (!toDate || item.trading_date <= toDate) && (actionFilter === 'ALL' || item.action === actionFilter)) }, [rows, symbolFilter, fromDate, toDate, actionFilter])
  const hasFilters = Boolean(symbolFilter || fromDate || toDate || actionFilter !== 'ALL')
  const clearFilters = () => { setSymbolFilter(''); setFromDate(''); setToDate(''); setActionFilter('ALL') }
  return <article className="panel transaction-history"><div className="panel-title"><h3>Lịch sử giao dịch</h3><span>{hasFilters ? `${filteredRows.length}/${rows.length} giao dịch` : `${rows.length} giao dịch`}</span></div><div className="transaction-filters" aria-label="Lọc lịch sử giao dịch"><label><span>Mã cổ phiếu</span><input value={symbolFilter} onChange={event => setSymbolFilter(event.target.value)} /></label><DateField label="Từ ngày" value={fromDate} onChange={setFromDate}/><DateField label="Đến ngày" value={toDate} onChange={setToDate}/><label><span>Hoạt động</span><select value={actionFilter} onChange={event => setActionFilter(event.target.value)}><option value="ALL">Tất cả hoạt động</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{hasFilters && <button type="button" className="transaction-filter-clear" onClick={clearFilters}>Xóa lọc</button>}</div>{transactions.isLoading ? <p className="muted">Đang tải giao dịch…</p> : filteredRows.length ? <div className="transaction-list">{filteredRows.map(item => <div className="transaction-row" key={item.id}><div><strong>{item.symbols?.symbol ?? '—'} · {labels[item.action] ?? item.action}</strong><small>{formatDate(item.trading_date)} · {item.quantity ? `${Number(item.quantity).toLocaleString('vi-VN')} CP` : 'Cập nhật stop'}{item.price ? ` · ${formatVnd(Number(item.price))}` : ''}</small>{item.note && <p>{item.note}</p>}</div><div className="transaction-actions"><button type="button" aria-label="Chỉnh sửa giao dịch" onClick={() => onEdit(item)}><Pencil size={15}/> Sửa</button><button type="button" className="danger" aria-label="Xoá giao dịch" onClick={() => onDelete(item)}><Trash2 size={15}/> Xoá</button></div></div>)}</div> : <p className="muted">{hasFilters ? 'Không có giao dịch khớp bộ lọc.' : 'Chưa có giao dịch nào.'}</p>}</article>
}
