import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Bell, BookOpen, BriefcaseBusiness, ChevronLeft, Command, FlaskConical, LayoutDashboard, Menu, Search, Settings, ShieldCheck, TrendingUp, Workflow, X } from 'lucide-react'
import { useDataHealth } from './hooks/useDataHealth'
import { useSymbols } from './hooks/useStockAnalysis'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { CommandPalette, openCommandPalette } from './components/CommandPalette'
import { TodayHealth } from './components/TodayHealth'
import { formatDate } from './lib/date'

const AnalysisPage = lazy(() => import('./components/AnalysisPage').then(m => ({ default: m.AnalysisPage })))
const RuleBuilderPage = lazy(() => import('./components/RuleBuilderPage').then(m => ({ default: m.RuleBuilderPage })))
const ScreenerPage = lazy(() => import('./components/ScreenerPage').then(m => ({ default: m.ScreenerPage })))
const BacktestPage = lazy(() => import('./components/BacktestPage').then(m => ({ default: m.BacktestPage })))
const PortfolioPage = lazy(() => import('./components/PortfolioPage').then(m => ({ default: m.PortfolioPage })))
const JournalPage = lazy(() => import('./components/JournalPage').then(m => ({ default: m.JournalPage })))
const SettingsPage = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })))

const modules = [
  { id: 'today', icon: LayoutDashboard, label: 'Tổng quan' }, { id: 'analysis', icon: BarChart3, label: 'Phân tích mã' },
  { id: 'screener', icon: Search, label: 'Screener' }, { id: 'rules', icon: Workflow, label: 'Rule Studio' },
  { id: 'backtest', icon: FlaskConical, label: 'Backtest' }, { id: 'portfolio', icon: BriefcaseBusiness, label: 'Danh mục' },
  { id: 'journal', icon: BookOpen, label: 'Nhật ký' }, { id: 'settings', icon: Settings, label: 'Cài đặt' },
]
const primaryMobile = modules.filter(item => ['today', 'analysis', 'screener', 'portfolio'].includes(item.id))
const moreMobile = modules.filter(item => ['rules', 'backtest', 'journal', 'settings'].includes(item.id))
function currentPage() { const value = location.hash.replace('#', ''); return modules.some(item => item.id === value) ? value : 'today' }

function App({ authenticated = false }: { authenticated?: boolean }) {
  const [page, setPage] = useState(currentPage); const [collapsed, setCollapsed] = useState(false); const [moreOpen, setMoreOpen] = useState(false)
  const health = useDataHealth(authenticated); const symbols = useSymbols(authenticated)
  const navCounts = useQuery({ queryKey: ['nav-counts'], enabled: authenticated && Boolean(supabase), queryFn: async () => { const [signals, rules] = await Promise.all([supabase!.from('signals').select('as_of_date').order('as_of_date', { ascending: false }).limit(205), supabase!.from('rules').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE')]); if (signals.error || rules.error) throw signals.error || rules.error; const latest = signals.data?.[0]?.as_of_date; return { signals: latest ? signals.data!.filter(item => item.as_of_date === latest).length : 0, rules: rules.count ?? 0 } } })
  const navigation = modules.map(item => ({ ...item, badge: item.id === 'screener' ? navCounts.data?.signals : item.id === 'rules' ? navCounts.data?.rules : undefined }))
  useEffect(() => { const update = () => { setPage(currentPage()); setMoreOpen(false); scrollTo({ top: 0, behavior: 'smooth' }) }; addEventListener('hashchange', update); return () => removeEventListener('hashchange', update) }, [])
  const connectionLabel = !isSupabaseConfigured ? 'Chưa kết nối Supabase' : health.isLoading ? 'Đang đồng bộ' : health.isError ? 'Pipeline cần kiểm tra' : 'Pipeline EOD trực tuyến'
  const pages: Record<string, React.ReactNode> = { analysis: <AnalysisPage authenticated={authenticated}/>, screener: <ScreenerPage authenticated={authenticated}/>, rules: <RuleBuilderPage authenticated={authenticated}/>, backtest: <BacktestPage authenticated={authenticated}/>, portfolio: <PortfolioPage authenticated={authenticated}/>, journal: <JournalPage authenticated={authenticated}/>, settings: <SettingsPage authenticated={authenticated}/> }
  return <div className={collapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
    <aside className="sidebar"><div className="sidebar-head"><a className="brand" href="#today"><span className="brand-mark">P</span><span className="brand-copy">Prot<span>Stock</span></span></a><button className="icon-button collapse-button" onClick={() => setCollapsed(v => !v)} aria-label="Thu gọn thanh bên"><ChevronLeft size={18}/></button></div><nav aria-label="Điều hướng chính">{navigation.map(item => <a className={page === item.id ? 'nav-item active' : 'nav-item'} href={`#${item.id}`} key={item.id}><item.icon size={19}/><span className="nav-label">{item.label}</span>{item.badge != null && <small className="nav-badge">{item.badge}</small>}</a>)}</nav><div className="sidebar-note"><span className="live-dot"/><span className="sidebar-note-copy">Pipeline EOD ổn định</span></div><button className="signout" onClick={() => supabase?.auth.signOut()}><span className="nav-label">Đăng xuất</span></button></aside>
    <main id="top"><div className="topbar"><button className="command-trigger" onClick={() => openCommandPalette()}><Search size={17}/><span>Tìm mã hoặc chức năng…</span><kbd><Command size={12}/> K</kbd></button><div className="topbar-actions"><div className="status-chip"><span className="live-dot"/>{connectionLabel}</div><button className="icon-button notification" aria-label="Thông báo"><Bell size={18}/><i/></button></div></div><div className="mobile-header"><a className="brand" href="#today"><span className="brand-mark">P</span><span className="brand-copy">Prot<span>Stock</span></span></a><div><button className="icon-button" onClick={() => openCommandPalette()}><Search size={19}/></button><span className="mobile-live"><span className="live-dot"/>EOD</span></div></div>
      {page === 'today' ? <Dashboard universeCount={health.data?.active_symbols ?? 205} connectionLabel={connectionLabel} health={health.data}/> : <Suspense fallback={<LoadingPage/>}>{pages[page]}</Suspense>}<footer className="app-footer">Prot Stock · Hệ thống nghiên cứu cá nhân · Không phải khuyến nghị đầu tư</footer></main>
    <nav className="bottom-nav">{primaryMobile.map(item => <a className={page === item.id ? 'active' : ''} href={`#${item.id}`} key={item.id}><item.icon size={21}/><span>{item.label === 'Phân tích mã' ? 'Phân tích' : item.label}</span></a>)}<button className={moreOpen || moreMobile.some(item => item.id === page) ? 'active' : ''} onClick={() => setMoreOpen(true)}><Menu size={21}/><span>Thêm</span></button></nav>
    {moreOpen && <div className="sheet-backdrop" onMouseDown={() => setMoreOpen(false)}><section className="bottom-sheet" onMouseDown={e => e.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><div><span className="eyebrow">WORKSPACE</span><h2>Mở thêm công cụ</h2></div><button className="icon-button" onClick={() => setMoreOpen(false)}><X size={20}/></button></div><div className="sheet-grid">{moreMobile.map(item => <a href={`#${item.id}`} key={item.id}><span><item.icon size={21}/></span><strong>{item.label}</strong><small>{item.id === 'rules' ? 'Thiết kế điều kiện' : item.id === 'backtest' ? 'Kiểm chứng lịch sử' : item.id === 'journal' ? 'Ghi và review' : 'Hệ thống'}</small></a>)}</div></section></div>}
    <CommandPalette symbols={symbols.data ?? []}/>
  </div>
}

function LoadingPage() { return <div className="skeleton-page"><div className="skeleton skeleton-title"/><div className="skeleton skeleton-card"/><div className="skeleton-grid">{[1,2,3,4].map(i => <div className="skeleton" key={i}/>)}</div></div> }
function Dashboard({ universeCount, connectionLabel, health }: { universeCount: number; connectionLabel: string; health?: { latest_price_date: string | null; failed_jobs_7d: number } }) {
  const signals = useQuery({ queryKey: ['today-signals'], enabled: Boolean(supabase), queryFn: async () => { const { data, error } = await supabase!.from('signals').select('id,action,score,as_of_date,reasons,symbols(symbol)').order('as_of_date', { ascending: false }).order('score', { ascending: false }).limit(6); if (error) throw error; return data ?? [] } })
  const [favorites,setFavorites]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('protstock-favorites')??'[]')}catch{return[]}})
  useEffect(()=>{const update=(event:Event)=>setFavorites((event as CustomEvent).detail);addEventListener('protstock:favorites',update);return()=>removeEventListener('protstock:favorites',update)},[])
  const feed=(signals.data??[]).map(item=>({...item,as_of_date:formatDate(item.as_of_date)}))
  return <section className="dashboard-page"><header className="dashboard-header"><div><span className="eyebrow">EOD INTELLIGENCE</span><h1>Tổng quan</h1><p>Không gian phân tích và quản trị giao dịch cá nhân.</p></div><a href="#screener" className="primary-button"><TrendingUp size={17}/> Mở Screener</a></header><section className="market-strip"><div><span className="live-dot"/><strong>{connectionLabel}</strong></div><span>Universe <b>{universeCount}</b></span><span>Dữ liệu <b>{health?.latest_price_date??'Chưa có'}</b></span><span>Lỗi 7 ngày <b className={health?.failed_jobs_7d?'negative':''}>{health?.failed_jobs_7d??0}</b></span></section><section className="dashboard-grid"><article className="panel signal-card"><div className="panel-title"><div><span className="eyebrow">TÍN HIỆU SAU PHIÊN</span><h2>Tín hiệu mới</h2></div><a href="#screener">Xem tất cả</a></div><div className="signal-stack">{signals.isLoading?<p className="muted">Đang tải tín hiệu…</p>:feed.length?feed.map((item:any)=><a href="#analysis" className="dashboard-signal" key={item.id} onClick={()=>localStorage.setItem('protstock-symbol',item.symbols?.symbol)}><span className="symbol-avatar">{item.symbols?.symbol?.slice(0,2)}</span><span><strong>{item.symbols?.symbol}</strong><small>{item.action?.replace('_',' ')}</small></span><b>{item.score}</b><em>{item.as_of_date}</em></a>):<p className="muted">Chưa có tín hiệu sau phiên.</p>}</div></article><article className="panel watch-card"><div className="panel-title"><div><span className="eyebrow">WATCHLIST</span><h2>Đang theo dõi</h2></div><button className="text-button" onClick={()=>openCommandPalette('symbols')}>+ Thêm mã</button></div>{favorites.length?favorites.map(symbol=><a href="#analysis" className="watch-row" key={symbol} onClick={()=>localStorage.setItem('protstock-symbol',symbol)}><strong>{symbol}</strong><span>Đang theo dõi</span><b>→</b></a>):<p className="muted">Chưa có mã nào trong watchlist.</p>}</article><TodayHealth/><article className="panel discipline-card"><div className="panel-title"><div><span className="eyebrow">DATA HEALTH</span><h2>Trạng thái hệ thống</h2></div><ShieldCheck size={23}/></div><p>{connectionLabel}. Dữ liệu mới nhất: {health?.latest_price_date??'chưa có dữ liệu EOD'}.</p><a href="#settings">Mở cài đặt <span>→</span></a></article></section></section>
}
export default App

