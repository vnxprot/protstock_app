import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, BookOpen, BriefcaseBusiness, FlaskConical, LayoutDashboard, Search, Settings, Star, TrendingUp, Workflow, X } from 'lucide-react'
import { isWatchActive, loadWatchlist, toggleWatchlistSymbol } from '../lib/watchlist'
import { useDialogFocus } from '../hooks/useDialogFocus'

export interface SymbolOption { symbol: string; sector?: string | null; exchange?: string | null }
const destinations = [
  { id: 'today', label: 'Tổng quan', icon: LayoutDashboard }, { id: 'market', label: 'Thị trường', icon: TrendingUp }, { id: 'analysis', label: 'Phân tích mã', icon: BarChart3 }, { id: 'screener', label: 'Bộ lọc tín hiệu', icon: Search }, { id: 'watchlist', label: 'Watchlist', icon: Star }, { id: 'watchlist-board', label: 'Bảng Watchlist', icon: Star }, { id: 'rules', label: 'Thiết lập quy tắc', icon: Workflow }, { id: 'backtest', label: 'Kiểm thử lịch sử', icon: FlaskConical }, { id: 'portfolio', label: 'Danh mục', icon: BriefcaseBusiness }, { id: 'journal', label: 'Nhật ký', icon: BookOpen }, { id: 'settings', label: 'Cài đặt và hướng dẫn', icon: Settings },
]
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase()
export function openCommandPalette(mode: 'all' | 'symbols' | 'ai' = 'all') { window.dispatchEvent(new CustomEvent('protstock:command', { detail: { mode } })) }
export function CommandPalette({ symbols = [], allowedRoutes = destinations.map(item => item.id) }: { symbols?: SymbolOption[]; allowedRoutes?: string[] }) {
  const [open, setOpen] = useState(false); const [mode, setMode] = useState<'all' | 'symbols' | 'help'>('all'); const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(() => loadWatchlist().filter(isWatchActive).map(item => item.symbol))
  const dialog = useRef<HTMLElement>(null); const close = useCallback(() => setOpen(false), [])
  useDialogFocus(open, dialog, close)
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '') || target?.isContentEditable; if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) { event.preventDefault(); setMode('all'); setQuery(''); setOpen(value => !value) } }
    const custom = (event: Event) => { const next = (event as CustomEvent).detail?.mode; setMode(next === 'ai' ? 'help' : next === 'symbols' ? 'symbols' : 'all'); setQuery(''); setOpen(true) }
    const sync = (event: Event) => setFavorites((event as CustomEvent<string[]>).detail)
    addEventListener('keydown', keyboard); addEventListener('protstock:command', custom); addEventListener('protstock:favorites', sync)
    return () => { removeEventListener('keydown', keyboard); removeEventListener('protstock:command', custom); removeEventListener('protstock:favorites', sync) }
  }, [])
  const filteredSymbols = useMemo(() => { const needle = normalize(query.trim()); return symbols.filter(item => !needle || normalize(`${item.symbol} ${item.sector ?? ''}`).includes(needle)).sort((a, b) => Number(favorites.includes(b.symbol)) - Number(favorites.includes(a.symbol)) || a.symbol.localeCompare(b.symbol)).slice(0, 18) }, [symbols, favorites, query])
  const routes = destinations.filter(item => mode === 'all' && allowedRoutes.includes(item.id) && (!query || normalize(item.label).includes(normalize(query))))
  function chooseSymbol(symbol: string) { localStorage.setItem('protstock-symbol', symbol); location.hash = 'analysis'; dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol })); close() }
  if (!open) return null
  return <div className="command-backdrop" onMouseDown={close}><section ref={dialog} tabIndex={-1} className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title" onMouseDown={event => event.stopPropagation()}>
    <h2 id="command-title" className="sr-only">Tìm mã và chức năng</h2>
    <form className="command-input" onSubmit={event => { event.preventDefault(); if (mode === 'help') return; if (filteredSymbols[0]) chooseSymbol(filteredSymbols[0].symbol); else if (routes[0]) { location.hash = routes[0].id; close() } }}><Search size={19}/><input aria-label="Tìm mã, ngành hoặc chức năng" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm mã, ngành hoặc chức năng…"/><button type="button" aria-label="Đóng tìm kiếm" onClick={close}><X size={18}/></button></form>
    <div className="command-tabs"><button className={mode !== 'help' ? 'active' : ''} onClick={() => setMode('all')}>Tra cứu</button><button className={mode === 'help' ? 'active' : ''} onClick={() => setMode('help')}>Hướng dẫn đọc tín hiệu</button></div>
    <div className="command-results">{mode === 'help' ? <div className="command-section"><h3>Đọc theo thứ tự tháng → tuần → ngày</h3><p>Tháng xác định xu hướng lớn, tuần xác định setup, ngày xác nhận trigger. Kiểm tra độ phủ dữ liệu và ngày đóng nến trước khi quyết định.</p><p>Điểm cấu trúc và Prot Flow là thước đo điều kiện kỹ thuật; ghi luận điểm cá nhân và điều kiện vô hiệu bên cạnh phân tích.</p><a className="secondary-button" href="#settings" onClick={close}>Mở hướng dẫn hệ thống</a></div> : <>
      {!!filteredSymbols.length && <div className="command-section"><div className="command-label">Mã cổ phiếu · ưu tiên Watchlist</div>{filteredSymbols.map(item => <div className="command-row" key={item.symbol}><button className="command-main" onClick={() => chooseSymbol(item.symbol)}><span className="symbol-avatar">{item.symbol.slice(0, 2)}</span><span><strong>{item.symbol}</strong><small>{item.sector || 'Chưa phân ngành'} · {item.exchange || 'VN'}</small></span></button><button type="button" className={favorites.includes(item.symbol) ? 'star active' : 'star'} aria-label={`${favorites.includes(item.symbol) ? 'Bỏ theo dõi' : 'Theo dõi'} ${item.symbol}`} onClick={() => toggleWatchlistSymbol(item.symbol)}><Star size={18} fill={favorites.includes(item.symbol) ? 'currentColor' : 'none'}/></button></div>)}</div>}
      {!!routes.length && <div className="command-section"><div className="command-label">Đi tới</div>{routes.map(item => <button className="command-main destination" key={item.id} onClick={() => { location.hash = item.id; close() }}><span className="command-icon"><item.icon size={18}/></span><strong>{item.label}</strong></button>)}</div>}
      {!filteredSymbols.length && !routes.length && <p className="command-empty">Không tìm thấy kết quả. Thử mã hoặc tên chức năng khác.</p>}
    </>}</div><footer className="command-footer"><span>Enter chọn kết quả đầu · Tab chuyển mục</span><span>Esc đóng · Ctrl K mở</span></footer>
  </section></div>
}
