import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, BookOpen, BriefcaseBusiness, Clock3, FlaskConical, LayoutDashboard, Search, Settings, ShieldCheck, Star, Workflow, X } from 'lucide-react'

export interface SymbolOption { symbol: string; sector?: string | null; exchange?: string | null }

const destinations = [
  { id: 'today', label: 'Tổng quan', hint: 'Bức tranh hôm nay', icon: LayoutDashboard },
  { id: 'analysis', label: 'Phân tích mã', hint: 'Chart và tín hiệu đa khung', icon: BarChart3 },
  { id: 'screener', label: 'Screener', hint: 'Lọc cơ hội sau phiên', icon: Search },
  { id: 'rules', label: 'Rule Studio', hint: 'Xây dựng kỷ luật giao dịch', icon: Workflow },
  { id: 'backtest', label: 'Backtest', hint: 'Kiểm chứng rule', icon: FlaskConical },
  { id: 'portfolio', label: 'Danh mục', hint: 'Vị thế và mức rủi ro', icon: BriefcaseBusiness },
  { id: 'journal', label: 'Nhật ký', hint: 'Vòng phản hồi quyết định', icon: BookOpen },
  { id: 'settings', label: 'Cài đặt', hint: 'Hệ thống và tài khoản', icon: Settings },
]

const fallbackSymbols: SymbolOption[] = [
  { symbol: 'FPT', sector: 'Công nghệ', exchange: 'HOSE' }, { symbol: 'HPG', sector: 'Thép', exchange: 'HOSE' },
  { symbol: 'MBB', sector: 'Ngân hàng', exchange: 'HOSE' }, { symbol: 'VNM', sector: 'Thực phẩm', exchange: 'HOSE' },
  { symbol: 'TDC', sector: 'BĐS KCN', exchange: 'HOSE' }, { symbol: 'VCB', sector: 'Ngân hàng', exchange: 'HOSE' },
  { symbol: 'SSI', sector: 'Chứng khoán', exchange: 'HOSE' }, { symbol: 'MWG', sector: 'Bán lẻ', exchange: 'HOSE' },
]

function storedList(key: string, fallback: string[]) {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as string[] } catch { return fallback }
}

export function openCommandPalette(mode: 'all' | 'symbols' = 'all') {
  window.dispatchEvent(new CustomEvent('protstock:command', { detail: { mode } }))
}

export function CommandPalette({ symbols = [], onSymbol }: { symbols?: SymbolOption[]; onSymbol?: (symbol: string) => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'all' | 'symbols'>('all')
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(() => storedList('protstock-favorites', ['FPT', 'HPG', 'MBB']))
  const [recent, setRecent] = useState<string[]>(() => storedList('protstock-recent', ['FPT', 'HPG']))
  const inputRef = useRef<HTMLInputElement>(null)
  const allSymbols = symbols.length ? symbols : fallbackSymbols

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' || (event.key === '/' && !typing)) {
        event.preventDefault(); setMode('all'); setOpen(value => !value)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    const custom = (event: Event) => { const detail = (event as CustomEvent).detail; setMode(detail?.mode ?? 'all'); setOpen(true) }
    window.addEventListener('keydown', keyboard)
    window.addEventListener('protstock:command', custom)
    return () => { window.removeEventListener('keydown', keyboard); window.removeEventListener('protstock:command', custom) }
  }, [])

  useEffect(() => { if (open) { setQuery(''); window.setTimeout(() => inputRef.current?.focus(), 30) } }, [open])

  const filteredSymbols = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allSymbols.filter(item => !needle || item.symbol.toLowerCase().includes(needle) || item.sector?.toLowerCase().includes(needle)).sort((a, b) => Number(favorites.includes(b.symbol)) - Number(favorites.includes(a.symbol))).slice(0, 18)
  }, [allSymbols, favorites, query])
  const filteredDestinations = destinations.filter(item => mode === 'all' && (!query || `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase())))

  function chooseSymbol(symbol: string) {
    const next = [symbol, ...recent.filter(item => item !== symbol)].slice(0, 5)
    setRecent(next); localStorage.setItem('protstock-recent', JSON.stringify(next)); localStorage.setItem('protstock-symbol', symbol)
    onSymbol?.(symbol); window.location.hash = 'analysis'; window.dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol })); setOpen(false)
  }
  function toggleFavorite(symbol: string) {
    const next = favorites.includes(symbol) ? favorites.filter(item => item !== symbol) : [symbol, ...favorites]
    setFavorites(next); localStorage.setItem('protstock-favorites', JSON.stringify(next))
  }
  if (!open) return null

  return <div className="command-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
    <section className="command-dialog" role="dialog" aria-modal="true" aria-label="Tìm kiếm và điều hướng" onMouseDown={event => event.stopPropagation()}>
      <div className="command-input"><Search size={19}/><input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'symbols' ? 'Tìm mã hoặc ngành…' : 'Tìm mã hoặc chuyển nhanh tới…'} /><kbd>ESC</kbd><button aria-label="Đóng" onClick={() => setOpen(false)}><X size={18}/></button></div>
      <div className="command-results">
        {!query && recent.length > 0 && <div className="command-section"><div className="command-label"><span><Clock3 size={13}/> Gần đây</span></div><div className="recent-chips">{recent.map(symbol => <button key={symbol} onClick={() => chooseSymbol(symbol)}>{symbol}</button>)}</div></div>}
        {filteredSymbols.length > 0 && <div className="command-section"><div className="command-label"><span>Mã cổ phiếu</span><small>{favorites.length} đang theo dõi</small></div>{filteredSymbols.map(item => <div className="command-row" key={item.symbol}><button className="command-main" onClick={() => chooseSymbol(item.symbol)}><span className="symbol-avatar">{item.symbol.slice(0, 2)}</span><span><strong>{item.symbol}</strong><small>{item.sector || 'Chưa phân ngành'} · {item.exchange || 'VN'}</small></span></button><button className={favorites.includes(item.symbol) ? 'star active' : 'star'} aria-label={`${favorites.includes(item.symbol) ? 'Bỏ ghim' : 'Ghim'} ${item.symbol}`} onClick={() => toggleFavorite(item.symbol)}><Star size={17} fill={favorites.includes(item.symbol) ? 'currentColor' : 'none'}/></button></div>)}</div>}
        {filteredDestinations.length > 0 && <div className="command-section"><div className="command-label"><span>Đi tới</span></div>{filteredDestinations.map(item => <button className="command-main destination" key={item.id} onClick={() => { window.location.hash = item.id; setOpen(false) }}><span className="command-icon"><item.icon size={18}/></span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}</div>}
        {!filteredSymbols.length && !filteredDestinations.length && <div className="command-empty"><ShieldCheck size={24}/><strong>Không tìm thấy kết quả</strong><span>Thử mã cổ phiếu hoặc tên chức năng khác.</span></div>}
      </div>
      <footer className="command-footer"><span><kbd>↵</kbd> chọn</span><span><kbd>Ctrl K</kbd> mở nhanh</span><span>Dữ liệu EOD · 205 mã</span></footer>
    </section>
  </div>
}
