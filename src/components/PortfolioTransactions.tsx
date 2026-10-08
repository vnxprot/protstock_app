import { useEffect, useMemo, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { formatDate } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'
import { realizedSlices } from '../lib/portfolioLedger'
import { tradeCosts, type CostRate } from '../lib/portfolioCosts'
import { DateField } from './DateField'
import { SoftSelect } from './SoftSelect'

const labels: Record<string, string> = { BUY_NEW: 'Mua mới', BUY_ADD: 'Mua thêm', SELL_REDUCE: 'Bán giảm', SELL_CLOSE: 'Đóng vị thế', STOP_UPDATE: 'Điều chỉnh stop' }
export type PortfolioTransaction = { id: string; symbol_id: string; trading_date: string; created_at?: string; action: string; quantity: number; price: number | null; broker_fee_override?: number | null; sell_tax_override?: number | null; stop_price: number | null; note: string | null; symbols: { symbol: string; sector?: string | null } | null }

export function PortfolioTransactions({ transactions = [], rates = [], loading, error, onRetry, onEdit, onDelete }: { transactions?: PortfolioTransaction[]; rates?: CostRate[]; loading: boolean; error: boolean; onRetry: () => void; onEdit: (item: PortfolioTransaction) => void; onDelete: (item: PortfolioTransaction) => void }) {
  const [symbolFilter, setSymbolFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [actionFilter, setActionFilter] = useState('ALL')
  const [page, setPage] = useState(1)
  const rows = useMemo(() => transactions.map(item => ({ ...item, symbols: Array.isArray(item.symbols) ? item.symbols[0] ?? null : item.symbols })).sort((a,b) => b.trading_date.localeCompare(a.trading_date) || (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id.localeCompare(a.id)), [transactions])
  const realizedById = useMemo(() => realizedSlices(rows, rates), [rows, rates])
  const filteredRows = useMemo(() => { const query = symbolFilter.trim().toUpperCase(); return rows.filter(item => (!query || (item.symbols?.symbol ?? '').toUpperCase().includes(query)) && (!fromDate || item.trading_date >= fromDate) && (!toDate || item.trading_date <= toDate) && (actionFilter === 'ALL' || item.action === actionFilter)) }, [rows, symbolFilter, fromDate, toDate, actionFilter])
  useEffect(() => setPage(1), [symbolFilter, fromDate, toDate, actionFilter])
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / 50))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = filteredRows.slice((currentPage - 1) * 50, currentPage * 50)
  const hasFilters = Boolean(symbolFilter || fromDate || toDate || actionFilter !== 'ALL')
  const clearFilters = () => { setSymbolFilter(''); setFromDate(''); setToDate(''); setActionFilter('ALL') }
  return <article className="panel transaction-history">
    <div className="panel-title"><h3>Lịch sử giao dịch</h3><span>{hasFilters ? `${filteredRows.length}/${rows.length} giao dịch` : `${rows.length} giao dịch`}</span></div>
    <p className="muted">Lãi/lỗ đã bán dùng giá vốn bình quân gồm phí mua; trừ phí bán và thuế TNCN theo ngày giao dịch.</p>
    <div className="transaction-filters" aria-label="Lọc lịch sử giao dịch"><label><span>Mã cổ phiếu</span><input value={symbolFilter} onChange={event => setSymbolFilter(event.target.value)} /></label><DateField label="Từ ngày" value={fromDate} onChange={setFromDate}/><DateField label="Đến ngày" value={toDate} onChange={setToDate}/><label><span>Hoạt động</span><SoftSelect aria-label="Lọc hoạt động giao dịch" value={actionFilter} onChange={event => setActionFilter(event.target.value)}><option value="ALL">Tất cả hoạt động</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</SoftSelect></label>{hasFilters && <button type="button" className="transaction-filter-clear" onClick={clearFilters}>Xóa lọc</button>}</div>
    {fromDate && toDate && fromDate > toDate && <p className="form-error">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
    {loading ? <p role="status">Đang tải sổ giao dịch…</p> : error ? <p className="form-error" role="alert">Không tải được sổ giao dịch. <button type="button" onClick={onRetry}>Thử lại</button></p> : visibleRows.length ? <div className="transaction-list">{visibleRows.map(item => { const realized = realizedById[item.id], costs = tradeCosts(item, rates); return <div className="transaction-row" key={item.id}><div><strong>{item.symbols?.symbol ?? '—'} · {labels[item.action] ?? item.action}</strong><small>{formatDate(item.trading_date)} · {item.quantity ? `${Number(item.quantity).toLocaleString('vi-VN')} CP` : 'Cập nhật stop'}{item.price ? ` · ${formatVnd(Number(item.price))}` : ''}</small>{item.action !== 'STOP_UPDATE' && <small>Phí giao dịch {formatVnd(costs.brokerFee)}{item.action.startsWith('SELL') ? ` · Thuế bán ${formatVnd(costs.sellTax)}` : ''}{item.broker_fee_override != null || item.sell_tax_override != null ? ' · có số thực tế' : ' · theo biểu phí'}</small>}{realized && <span className={`transaction-realized ${realized.pnl < 0 ? 'negative' : 'positive'}`}><b>Lãi/lỗ phần bán {realized.pnl >= 0 ? '+' : ''}{formatVnd(realized.pnl)}</b><small>{realized.returnPct >= 0 ? '+' : ''}{realized.returnPct.toFixed(2)}% · mua từ {formatDate(realized.openedAt)}</small></span>}{item.note && <p>{item.note}</p>}</div><div className="transaction-actions"><button type="button" aria-label={`Chỉnh sửa giao dịch ${item.symbols?.symbol ?? ''}`} onClick={() => onEdit(item)}><Pencil size={15}/> Sửa</button><button type="button" className="danger" aria-label={`Xoá giao dịch ${item.symbols?.symbol ?? ''}`} onClick={() => onDelete(item)}><Trash2 size={15}/> Xoá</button></div></div> })}</div> : <p className="muted">{hasFilters ? 'Không có giao dịch khớp bộ lọc.' : 'Chưa có giao dịch nào.'}</p>}
    {pageCount > 1 && <nav className="screener-pagination" aria-label="Phân trang giao dịch"><span>Trang {currentPage}/{pageCount} · {filteredRows.length} giao dịch</span><div><button type="button" disabled={currentPage === 1} onClick={() => setPage(value => value - 1)}>Trước</button><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(value => value + 1)}>Sau</button></div></nav>}
  </article>
}
