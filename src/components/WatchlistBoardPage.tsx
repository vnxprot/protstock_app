import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowUpRight, Filter } from 'lucide-react'
import { isWatchActive, updateWatchlistItem, useWatchlist, WATCHLIST_DETAIL_LIMIT, WATCHLIST_REASON_LIMIT, type WatchItem, type WatchPatch, type WatchStatus, type WatchTier } from '../lib/watchlist'
import { useAccountId } from '../hooks/useAccountId'
import '../watchlist-board.css'

type TextField = 'reason' | 'buyZone' | 'targetPrice' | 'stopLoss'
const columns: { key: TextField; label: string }[] = [
  { key: 'reason', label: 'Lý do đầu tư' },
  { key: 'buyZone', label: 'Điểm mua' },
  { key: 'targetPrice', label: 'Mục tiêu' },
  { key: 'stopLoss', label: 'Cắt lỗ' },
]
const tierRank: Record<WatchTier, number> = { S: 0, A: 1, B: 2 }
type FilterKey = 'stt' | 'tier' | 'symbol' | TextField | 'status'
type Filters = Record<FilterKey, string>

function HeaderFilter({ label, value, onChange, choices, numeric = false }: {
  label: string; value: string; onChange: (value: string) => void
  choices?: { value: string; label: string }[]; numeric?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    const closeOnScroll = (event: Event) => { if (!popover.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); window.removeEventListener('scroll', closeOnScroll, true) }
  }, [open])
  const toggle = () => {
    if (!open && trigger.current) {
      const rect = trigger.current.getBoundingClientRect()
      setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248)) })
    }
    setOpen(!open)
  }
  return <div className="watch-board-header-field"><span>{label}</span><button ref={trigger} type="button" className={value && value !== 'ALL' ? 'watch-board-filter-trigger active' : 'watch-board-filter-trigger'} aria-label={`Lọc ${label}`} aria-expanded={open} onClick={toggle}><Filter size={15}/></button>
    {open && createPortal(<div ref={popover} className="watch-board-filter-popover" style={position} role="group" aria-label={`Lọc ${label}`}>
      <strong>{label}</strong>
      {choices ? <div className="watch-board-filter-options">{choices.map(choice => <button key={choice.value} type="button" className={value === choice.value ? 'active' : ''} onClick={() => { onChange(choice.value); setOpen(false) }}>{choice.label}</button>)}</div>
        : <input autoFocus aria-label={`Nhập giá trị lọc ${label}`} inputMode={numeric ? 'numeric' : 'search'} value={value} onChange={event => onChange(event.target.value)} placeholder={`Tìm ${label.toLocaleLowerCase('vi')}…`}/>}
      {!choices && value && <button type="button" className="watch-board-filter-clear" onClick={() => onChange('')}>Xóa bộ lọc</button>}
    </div>, document.body)}
  </div>
}

function EditableCell({ item, field, userId }: { item: WatchItem; field: TextField; userId: string | null }) {
  const [saveError, setSaveError] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null), dirty = useRef(false)
  const storageKeyRef = useRef<string | null>(null)
  const draftStorageKey = userId ? 'protstock-watchlist-field-draft:' + userId + ':' + item.symbol + ':' + field : null
  const resize = () => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }
  useEffect(() => {
    const input = inputRef.current
    if (input && document.activeElement === input && dirty.current) {
      try {
        if (draftStorageKey) localStorage.setItem(draftStorageKey, input.value)
        if (storageKeyRef.current && storageKeyRef.current !== draftStorageKey) localStorage.removeItem(storageKeyRef.current)
      } catch { setSaveError(true) }
      storageKeyRef.current = draftStorageKey
      return
    }
    dirty.current = false; setSaveError(false)
    let stored: string | null = null
    try { if (draftStorageKey) stored = localStorage.getItem(draftStorageKey) } catch { /* The current value remains available. */ }
    dirty.current = stored !== null
    storageKeyRef.current = draftStorageKey
    if (input) input.value = stored ?? item[field]
    resize()
  }, [draftStorageKey, item.symbol])
  useEffect(() => { if (!dirty.current && inputRef.current && document.activeElement !== inputRef.current) { inputRef.current.value = item[field]; resize() } }, [item[field]])
  const commit = () => {
    const value = inputRef.current?.value.trim() ?? ''
    try {
      if (value !== item[field]) updateWatchlistItem(item.symbol, { [field]: value } as WatchPatch)
      dirty.current = false; setSaveError(false)
      if (storageKeyRef.current) localStorage.removeItem(storageKeyRef.current)
    } catch { setSaveError(true) }
  }
  return <><textarea ref={inputRef} aria-label={(columns.find(column=>column.key===field)?.label ?? field) + ' ' + item.symbol} defaultValue={item[field]} rows={1}
    maxLength={field === 'reason' ? WATCHLIST_REASON_LIMIT : WATCHLIST_DETAIL_LIMIT} onChange={event => {
      dirty.current = true; resize()
      try { if (storageKeyRef.current) localStorage.setItem(storageKeyRef.current, event.target.value) } catch { setSaveError(true) }
    }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.blur() }}/>
    {saveError && <small role="alert">Chưa lưu được thay đổi; nội dung đang giữ trong ô.</small>}</>
}

function openAnalysis(symbol: string) {
  localStorage.setItem('protstock-symbol', symbol)
  dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol }))
  location.hash = 'analysis'
}

export function WatchlistBoardPage({ syncStatus, authenticated = false }: { syncStatus: 'loading' | 'ready' | 'error'; authenticated?: boolean }) {
  const userId = useAccountId(authenticated)
  const items = useWatchlist()
  const [filters, setFilters] = useState<Filters>({ stt: '', tier: 'ALL', symbol: '', reason: '', buyZone: '', targetPrice: '', stopLoss: '', status: 'ALL' })
  const ordered = useMemo(() => [...items].sort((a, b) => tierRank[a.tier] - tierRank[b.tier]
    || Number(isWatchActive(b)) - Number(isWatchActive(a)) || a.symbol.localeCompare(b.symbol)), [items])
  const visible = useMemo(() => ordered.map((item, index) => ({ item, number: index + 1 })).filter(({ item, number }) =>
    (!filters.stt || String(number).includes(filters.stt.trim()))
    && (filters.tier === 'ALL' || item.tier === filters.tier)
    && (filters.status === 'ALL' || item.status === filters.status)
    && (['symbol', ...columns.map(column => column.key)] as const).every(key =>
      item[key].toLocaleLowerCase('vi').includes(filters[key].trim().toLocaleLowerCase('vi')))
  ), [ordered, filters])
  const updateFilter = (key: FilterKey, value: string) => setFilters(current => ({ ...current, [key]: value }))
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
      <th scope="col"><HeaderFilter label="STT" value={filters.stt} onChange={value => updateFilter('stt', value)} numeric/></th>
      <th scope="col"><HeaderFilter label="Tier" value={filters.tier} onChange={value => updateFilter('tier', value)} choices={[{ value: 'ALL', label: 'Tất cả' }, { value: 'S', label: 'S' }, { value: 'A', label: 'A' }, { value: 'B', label: 'B' }]}/></th>
      <th scope="col"><HeaderFilter label="Mã cổ phiếu" value={filters.symbol} onChange={value => updateFilter('symbol', value)}/></th>
      {columns.map(column => <th scope="col" key={column.key}><HeaderFilter label={column.label} value={filters[column.key]} onChange={value => updateFilter(column.key, value)}/></th>)}
      <th scope="col"><HeaderFilter label="Tình trạng" value={filters.status} onChange={value => updateFilter('status', value)} choices={[{ value: 'ALL', label: 'Tất cả' }, { value: 'On', label: 'On' }, { value: 'Off', label: 'Off' }]}/></th>
    </tr></thead><tbody>{visible.map(({ item, number }) => <tr key={item.symbol} className={isWatchActive(item) ? '' : 'watch-board-off'}>
      <td className="watch-board-index">{number}</td>
      <td><select aria-label={`Tier ${item.symbol}`} value={item.tier} onChange={event => updateWatchlistItem(item.symbol, { tier: event.target.value as WatchTier, status: 'On' })}><option value="S">S</option><option value="A">A</option><option value="B">B</option></select></td>
      <td><button type="button" className="watch-board-symbol" onClick={() => openAnalysis(item.symbol)}>{item.symbol}<ArrowUpRight size={14}/></button></td>
      {columns.map(column => <td key={column.key}><EditableCell item={item} field={column.key} userId={userId}/></td>)}
      <td><select aria-label={`Tình trạng ${item.symbol}`} className={item.status === 'On' ? 'watch-board-status-on' : 'watch-board-status-off'} value={item.status as WatchStatus} onChange={event => updateWatchlistItem(item.symbol, { status: event.target.value as WatchStatus })}><option value="On">On</option><option value="Off">Off</option></select></td>
    </tr>)}</tbody></table>
      {!visible.length && <p className="watch-board-empty">{items.length ? 'Không có mã khớp bộ lọc.' : 'Chưa có mã. Thêm mã vào Tier B, A hoặc S ở trang Watchlist.'}</p>}
    </div><p className="watch-board-footnote">On: đang theo dõi hoặc nắm giữ · Off: đã hoàn thành, không còn ở Card Tier. Chọn lại On hoặc chọn Tier để đưa mã trở lại.</p>
  </section>
}
