import { useQuery } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'

const labels: Record<string, string> = { BUY_NEW: 'Mua mới', BUY_ADD: 'Mua thêm', SELL_REDUCE: 'Bán giảm', SELL_CLOSE: 'Đóng vị thế', STOP_UPDATE: 'Điều chỉnh stop' }

export type PortfolioTransaction = { id: string; trading_date: string; action: string; quantity: number; price: number | null; stop_price: number | null; note: string | null; symbols: { symbol: string; sector?: string | null } | null }

export function PortfolioTransactions({ authenticated, onEdit, onDelete }: { authenticated: boolean; onEdit: (item: PortfolioTransaction) => void; onDelete: (item: PortfolioTransaction) => void }) {
  const transactions = useQuery({ queryKey: ['portfolio-transactions'], enabled: authenticated && Boolean(supabase), queryFn: async () => {
    const { data, error } = await supabase!.from('portfolio_transactions').select('id,trading_date,action,quantity,price,stop_price,note,symbols(symbol,sector)').order('trading_date', { ascending: false }).order('created_at', { ascending: false }).limit(100)
    if (error) throw error
    return (data ?? []).map((item: any) => ({ ...item, symbols: Array.isArray(item.symbols) ? item.symbols[0] ?? null : item.symbols })) as PortfolioTransaction[]
  } })
  const rows = transactions.data ?? []
  return <article className="panel transaction-history"><div className="panel-title"><h3>Lịch sử giao dịch</h3><span>{rows.length} giao dịch</span></div>{transactions.isLoading ? <p className="muted">Đang tải giao dịch…</p> : rows.length ? <div className="transaction-list">{rows.map(item => <div className="transaction-row" key={item.id}><div><strong>{item.symbols?.symbol ?? '—'} · {labels[item.action] ?? item.action}</strong><small>{formatDate(item.trading_date)} · {item.quantity ? `${Number(item.quantity).toLocaleString('vi-VN')} CP` : 'Cập nhật stop'}{item.price ? ` · ${formatVnd(Number(item.price))}` : ''}</small>{item.note && <p>{item.note}</p>}</div><div className="transaction-actions"><button type="button" aria-label="Chỉnh sửa giao dịch" onClick={() => onEdit(item)}><Pencil size={15}/> Sửa</button><button type="button" className="danger" aria-label="Xoá giao dịch" onClick={() => onDelete(item)}><Trash2 size={15}/> Xoá</button></div></div>)}</div> : <p className="muted">Chưa có giao dịch nào.</p>}</article>
}
