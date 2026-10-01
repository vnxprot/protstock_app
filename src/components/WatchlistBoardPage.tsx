import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { isWatchActive, updateWatchlistItem, useWatchlist, type WatchItem, type WatchPatch, type WatchStatus, type WatchTier } from '../lib/watchlist'
import '../watchlist-board.css'

type TextField = 'reason' | 'buyZone' | 'targetPrice' | 'stopLoss'
const columns: { key: TextField; label: string }[] = [
  { key: 'reason', label: 'Lý do đầu tư' },
  { key: 'buyZone', label: 'Điểm mua' },
  { key: 'targetPrice', label: 'Mục tiêu' },
  { key: 'stopLoss', label: 'Cắt lỗ' },
]
const tierRank: Record<WatchTier, number> = { S: 0, A: 1, B: 2 }

function EditableCell({ item, field }: { item: WatchItem; field: TextField }) {
  const [draft, setDraft] = useState(item[field])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setDraft(item[field]), [item[field], item.symbol])
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }, [draft])
  const commit = () => {
    const value = draft.trim()
    if (value !== item[field]) updateWatchlistItem(item.symbol, { [field]: value } as WatchPatch)
  }
  return <textarea ref={inputRef} aria-label={`${field} ${item.symbol}`} value={draft} rows={1}
    maxLength={field === 'reason' ? 500 : 120} onChange={event => setDraft(event.target.value)}
    onBlur={commit} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.blur() }}/>
}

function openAnalysis(symbol: string) {
  localStorage.setItem('protstock-symbol', symbol)
  dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol }))
  location.hash = 'analysis'
}

export function WatchlistBoardPage({ syncStatus }: { syncStatus: 'loading' | 'ready' | 'error' }) {
  const items = useWatchlist()
  const [filters, setFilters] = useState({ stt: '', tier: 'ALL', symbol: '', reason: '', buyZone: '', targetPrice: '', stopLoss: '', status: 'ALL' })
  const ordered = useMemo(() => [...items].sort((a, b) => tierRank[a.tier] - tierRank[b.tier]
    || Number(isWatchActive(b)) - Number(isWatchActive(a)) || a.symbol.localeCompare(b.symbol)), [items])
  const visible = useMemo(() => ordered.map((item, index) => ({ item, number: index + 1 })).filter(({ item, number }) =>
    (!filters.stt || String(number).includes(filters.stt.trim()))
    && (filters.tier === 'ALL' || item.tier === filters.tier)
    && (filters.status === 'ALL' || item.status === filters.status)
    && (['symbol', ...columns.map(column => column.key)] as const).every(key =>
      item[key].toLocaleLowerCase('vi').includes(filters[key].trim().toLocaleLowerCase('vi')))
  ), [ordered, filters])
  const updateFilter = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }))
  return <section className="workspace-page watch-board-page">
    <div className="watch-board-heading"><div><a href="#watchlist" className="watch-board-back"><ArrowLeft size={16}/> Watchlist</a>
      <h1>Bảng Những mã để mắt tới</h1><p>Điền trực tiếp vào từng ô. Nội dung được lưu khi rời ô; bảng xếp Tier S → A → B, trong mỗi Tier mã On đứng trước.</p></div>
      <div className="watch-board-count"><strong>{items.filter(isWatchActive).length}</strong><span>On</span><strong>{items.filter(item => !isWatchActive(item)).length}</strong><span>Off</span></div></div>
    {syncStatus === 'error' && <p className="watchlist-sync-warning" role="status">Chưa đồng bộ được bảng với tài khoản. Dữ liệu trên thiết bị này vẫn được giữ; hãy kiểm tra kết nối.</p>}
    <div className="watch-board-scroll"><table className="watch-board-table"><colgroup>
      <col className="watch-board-col-index"/><col className="watch-board-col-tier"/><col className="watch-board-col-symbol"/>
      <col className="watch-board-col-reason"/>
      <col className="watch-board-col-price"/><col className="watch-board-col-price"/><col className="watch-board-col-price"/>
      <col className="watch-board-col-status"/>
    </colgroup><thead><tr>
      <th scope="col">STT</th><th scope="col">Tier</th><th scope="col">Mã cổ phiếu</th>
      {columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}<th scope="col">Tình trạng</th>
    </tr><tr className="watch-board-filters">
      <th><input aria-label="Lọc STT" inputMode="numeric" value={filters.stt} onChange={event => updateFilter('stt', event.target.value)}/></th>
      <th><select aria-label="Lọc Tier" value={filters.tier} onChange={event => updateFilter('tier', event.target.value)}><option value="ALL">Tất cả</option><option value="S">S</option><option value="A">A</option><option value="B">B</option></select></th>
      <th><input aria-label="Lọc mã cổ phiếu" value={filters.symbol} onChange={event => updateFilter('symbol', event.target.value)}/></th>
      {columns.map(column => <th key={column.key}><input aria-label={`Lọc ${column.label}`} value={filters[column.key]} onChange={event => updateFilter(column.key, event.target.value)}/></th>)}
      <th><select aria-label="Lọc tình trạng" value={filters.status} onChange={event => updateFilter('status', event.target.value)}><option value="ALL">Tất cả</option><option value="On">On</option><option value="Off">Off</option></select></th>
    </tr></thead><tbody>{visible.map(({ item, number }) => <tr key={item.symbol} className={isWatchActive(item) ? '' : 'watch-board-off'}>
      <td className="watch-board-index">{number}</td>
      <td><select aria-label={`Tier ${item.symbol}`} value={item.tier} onChange={event => updateWatchlistItem(item.symbol, { tier: event.target.value as WatchTier, status: 'On' })}><option value="S">S</option><option value="A">A</option><option value="B">B</option></select></td>
      <td><button type="button" className="watch-board-symbol" onClick={() => openAnalysis(item.symbol)}>{item.symbol}<ArrowUpRight size={14}/></button></td>
      {columns.map(column => <td key={column.key}><EditableCell item={item} field={column.key}/></td>)}
      <td><select aria-label={`Tình trạng ${item.symbol}`} className={item.status === 'On' ? 'watch-board-status-on' : 'watch-board-status-off'} value={item.status as WatchStatus} onChange={event => updateWatchlistItem(item.symbol, { status: event.target.value as WatchStatus })}><option value="On">On</option><option value="Off">Off</option></select></td>
    </tr>)}</tbody></table>
      {!visible.length && <p className="watch-board-empty">{items.length ? 'Không có mã khớp bộ lọc.' : 'Chưa có mã. Thêm mã vào Tier B, A hoặc S ở trang Watchlist.'}</p>}
    </div><p className="watch-board-footnote">On: đang theo dõi hoặc nắm giữ · Off: đã hoàn thành, không còn ở Card Tier. Chọn lại On hoặc chọn Tier để đưa mã trở lại.</p>
  </section>
}
