import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { UserProfile } from './AuthGate'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, BookOpen, BriefcaseBusiness, CheckCircle2, ChevronDown, ChevronLeft, CloudOff, Command, FlaskConical, LayoutDashboard, LoaderCircle, LogOut, Menu, Search, Settings, ShieldCheck, Star, TrendingUp, UserRound, Workflow, X } from 'lucide-react'
import { useDataHealth } from './hooks/useDataHealth'
import { useDialogFocus } from './hooks/useDialogFocus'
import { useSymbols } from './hooks/useStockAnalysis'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { CommandPalette, openCommandPalette } from './components/CommandPalette'
import { TodayHealth } from './components/TodayHealth'
import { formatDate } from './lib/date'
import { version as appVersion } from '../package.json'
import { ThemeToggle } from './components/ThemeToggle'
import { SignalDecisionBoard } from './components/SignalDecisionBoard'
import { HealthMethodDetails } from './components/HealthMethodDetails'
import { latestSignalPublication } from './lib/signalPublication'
import { isWatchActive, useWatchlist, useWatchlistCloud } from './lib/watchlist'

const AnalysisPage = lazy(() => import('./components/AnalysisPage').then(m => ({ default: m.AnalysisPage })))
const RuleBuilderPage = lazy(() => import('./components/RuleBuilderPage').then(m => ({ default: m.RuleBuilderPage })))
const ScreenerPage = lazy(() => import('./components/ScreenerPage').then(m => ({ default: m.ScreenerPage })))
const BacktestPage = lazy(() => import('./components/BacktestPage').then(m => ({ default: m.BacktestPage })))
const PortfolioPage = lazy(() => import('./components/PortfolioPage').then(m => ({ default: m.PortfolioPage })))
const JournalPage = lazy(() => import('./components/JournalPage').then(m => ({ default: m.JournalPage })))
const SettingsPage = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })))
const AdminPage = lazy(() => import('./components/AdminPage').then(m => ({ default: m.AdminPage })))
const UniversePage = lazy(() => import('./components/UniversePage').then(m => ({ default: m.UniversePage })))
const MarketPage = lazy(() => import('./components/MarketPage').then(m => ({ default: m.MarketPage })))
const WatchlistPage = lazy(() => import('./components/WatchlistPage').then(m => ({ default: m.WatchlistPage })))
const WatchlistBoardPage = lazy(() => import('./components/WatchlistBoardPage').then(m => ({ default: m.WatchlistBoardPage })))

const modules = [
  { id: 'today', icon: LayoutDashboard, label: 'Tổng quan' }, { id: 'market', icon: TrendingUp, label: 'Thị trường' }, { id: 'analysis', icon: BarChart3, label: 'Phân tích mã' },
  { id: 'screener', icon: Search, label: 'Bộ lọc tín hiệu' }, { id: 'watchlist', icon: Star, label: 'Watchlist' }, { id: 'rules', icon: Workflow, label: 'Thiết lập quy tắc' },
  { id: 'backtest', icon: FlaskConical, label: 'Kiểm thử lịch sử' }, { id: 'portfolio', icon: BriefcaseBusiness, label: 'Danh mục' },
  { id: 'journal', icon: BookOpen, label: 'Nhật ký' }, { id: 'settings', icon: Settings, label: 'Cài đặt' },
]
const clientModules = modules.filter(item => ['today', 'market', 'analysis', 'screener', 'watchlist', 'settings'].includes(item.id))
const primaryMobile = modules.filter(item => ['today', 'market', 'analysis', 'screener', 'watchlist'].includes(item.id))
const moreMobile = modules.filter(item => ['rules', 'backtest', 'portfolio', 'journal', 'settings'].includes(item.id))
function currentPage() { const value = location.hash.replace('#', '').split('?')[0]; return [...modules, { id: 'admin' }, { id: 'universe' }, { id: 'watchlist-board' }].some(item => item.id === value) ? value : 'today' }

function App({ authenticated = false, profile = null }: { authenticated?: boolean; profile?: UserProfile | null }) {
  const [page, setPage] = useState(currentPage); const [collapsed, setCollapsed] = useState(false); const [accountOpen, setAccountOpen] = useState(false); const [moreOpen, setMoreOpen] = useState(false); const [compactMobileNav, setCompactMobileNav] = useState(false)
  const [signoutError, setSignoutError] = useState(false)
  const accountRef = useRef<HTMLElement>(null); const closeAccount = useCallback(() => setAccountOpen(false), [])
  const moreRef = useRef<HTMLElement>(null); const closeMore = useCallback(() => setMoreOpen(false), [])
  useDialogFocus(accountOpen, accountRef, closeAccount)
  useDialogFocus(moreOpen, moreRef, closeMore)
  const watchlistSync = useWatchlistCloud(profile?.user_id, supabase)
  const health = useDataHealth(authenticated); const symbols = useSymbols(authenticated)
  const navCounts = useQuery({ queryKey: ['nav-counts', profile?.user_id], enabled: authenticated && Boolean(supabase), staleTime: 300_000, queryFn: async () => { const [publication, rules] = await Promise.all([latestSignalPublication(), supabase!.from('rules').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE')]); if (rules.error) throw rules.error; return { signals: publication?.count ?? 0, rules: rules.count ?? 0 } } })
  const isAdmin = profile?.role === 'ADMIN'
  const permittedModules = isAdmin ? [...modules, { id: 'admin', icon: ShieldCheck, label: 'Quản trị' }] : clientModules
  const navigation = permittedModules.map(item => ({ ...item, badge: item.id === 'screener' ? navCounts.data?.signals : item.id === 'rules' ? navCounts.data?.rules : undefined }))
  useEffect(() => { const update = () => { setPage(currentPage()); setAccountOpen(false); setMoreOpen(false); setCompactMobileNav(false); scrollTo({ top: 0, behavior: 'auto' }) }; addEventListener('hashchange', update); return () => removeEventListener('hashchange', update) }, [])
  useEffect(() => {
    let startX = 0, startY = 0
    let nestedScroll = false
    const start = (event: TouchEvent) => { startX = event.touches[0]?.clientX ?? 0; startY = event.touches[0]?.clientY ?? 0; nestedScroll = event.target instanceof Element && Boolean(event.target.closest('.overview-watch-list')) }
    const end = (event: TouchEvent) => {
      if (!matchMedia('(max-width: 760px)').matches || nestedScroll) return
      const touch = event.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - startX, dy = touch.clientY - startY
      if (Math.abs(dy) < 45 || Math.abs(dy) < Math.abs(dx) * 1.2) return
      setCompactMobileNav(dy < 0)
    }
    addEventListener('touchstart', start, { passive: true })
    addEventListener('touchend', end, { passive: true })
    return () => { removeEventListener('touchstart', start); removeEventListener('touchend', end) }
  }, [])
  const connectionLabel = !isSupabaseConfigured ? 'Chưa kết nối dữ liệu' : health.isLoading ? 'Đang kết nối dữ liệu' : health.isError ? 'Chưa tải được dữ liệu' : 'Đã kết nối dữ liệu'
  const connectionState = !isSupabaseConfigured || health.isError ? 'error' : health.isLoading ? 'pending' : 'ready'
  const allowed = permittedModules.some(item => item.id === page) || page === 'universe' || page === 'watchlist-board' && permittedModules.some(item => item.id === 'watchlist')
  const activePage = allowed ? page : 'forbidden'
  const pages: Record<string, ReactNode> = { market: <MarketPage authenticated={authenticated}/>, analysis: <AnalysisPage authenticated={authenticated} canJournal={isAdmin}/>, screener: <ScreenerPage authenticated={authenticated} canJournal={isAdmin}/>, watchlist: <WatchlistPage authenticated={authenticated} syncStatus={watchlistSync} canJournal={isAdmin}/>, 'watchlist-board': <WatchlistBoardPage authenticated={authenticated} syncStatus={watchlistSync}/>, rules: <RuleBuilderPage authenticated={authenticated}/>, backtest: <BacktestPage authenticated={authenticated}/>, portfolio: <PortfolioPage authenticated={authenticated}/>, journal: <JournalPage authenticated={authenticated}/>, settings: <SettingsPage authenticated={authenticated} isAdmin={isAdmin} profile={profile}/>, universe: <UniversePage authenticated={authenticated}/>, admin: <AdminPage/>, forbidden: <div className="empty-state"><h1>Chức năng chưa được cấp quyền</h1><p>Tài khoản này chưa có quyền truy cập chức năng đã chọn.</p><a className="primary-button" href="#today">Về Tổng quan</a></div> }
  const signOut = async () => { const result = await supabase?.auth.signOut(); setSignoutError(Boolean(result?.error)) }
  return <div className={collapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Đến nội dung chính</a>
    <aside className="sidebar"><div className="sidebar-head"><a className="brand" href="#today" aria-label="Prot Stock · Tổng quan"><span className="brand-mark">P</span><span className="brand-copy">Prot<span>Stock</span></span></a><button className="icon-button collapse-button" onClick={() => setCollapsed(v => !v)} aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'} aria-expanded={!collapsed}><ChevronLeft size={18}/></button></div><nav aria-label="Điều hướng chính">{navigation.map(item => <a className={(activePage === item.id || activePage === 'watchlist-board' && item.id === 'watchlist') ? 'nav-item active' : 'nav-item'} data-tooltip={item.label} aria-label={item.label} aria-current={(activePage === item.id || activePage === 'watchlist-board' && item.id === 'watchlist') ? 'page' : undefined} href={`#${item.id}`} key={item.id}><item.icon size={19}/><span className="nav-label">{item.label}</span>{item.badge != null && <small className="nav-badge">{item.badge}</small>}</a>)}</nav><div className="sidebar-account"><button type="button" className="sidebar-profile" onClick={() => setAccountOpen(true)} aria-label="Mở thông tin tài khoản"><UserRound size={17}/><span><strong>{profile?.username ?? 'Tài khoản'}</strong><small>{isAdmin ? 'Quản trị viên' : 'Người dùng'}</small></span></button><button type="button" className="signout" onClick={() => void signOut()} disabled={!authenticated} aria-label="Đăng xuất"><LogOut size={17}/><span className="nav-label">Đăng xuất</span></button>{signoutError && <small className="sidebar-signout-error" role="alert">Chưa đăng xuất được.</small>}</div></aside>
    <main id="main-content" tabIndex={-1}><div className="topbar"><button className="command-trigger" onClick={() => openCommandPalette()}><Search size={17}/><span>Tìm mã hoặc chức năng…</span><kbd><Command size={12}/> K</kbd></button><div className="topbar-actions"><button className="account-chip" onClick={() => setAccountOpen(true)} aria-label="Mở tài khoản"><UserRound size={16}/><span>{profile?.username ?? 'Tài khoản'}</span></button><ThemeToggle/><a href="#settings" className={'status-chip '+connectionState}>{connectionState === 'ready' ? <CheckCircle2 size={16}/> : connectionState === 'pending' ? <LoaderCircle size={16} className="status-loading-icon"/> : <CloudOff size={16}/>}<span>{connectionLabel}</span></a></div></div><div className="mobile-header"><a className="brand" href="#today" aria-label="Prot Stock · Tổng quan"><span className="brand-mark">P</span><span className="brand-copy">Prot<span>Stock</span></span></a><div><ThemeToggle/><button className="icon-button" onClick={() => openCommandPalette()} aria-label="Tìm mã hoặc chức năng"><Search size={19}/></button><button className="mobile-live" onClick={() => setAccountOpen(true)} aria-label="Mở tài khoản">{profile?.username ?? 'Tài khoản'}</button></div></div>
      {activePage === 'today' ? <Dashboard syncStatus={watchlistSync}/> : <Suspense fallback={<LoadingPage/>}>{pages[activePage]}</Suspense>}<footer className="app-footer"><span>Prot Stock · Big movements take time to develop</span><span className="app-version" aria-label="Phiên bản ứng dụng">v{appVersion}</span></footer></main>
    <nav className={compactMobileNav ? 'bottom-nav six-items is-compact' : 'bottom-nav six-items'} aria-label="Điều hướng di động">{!isAdmin ? clientModules.map(item => <a className={(activePage === item.id || activePage === 'watchlist-board' && item.id === 'watchlist') ? 'active' : ''} href={`#${item.id}`} aria-label={item.label} aria-current={(activePage === item.id || activePage === 'watchlist-board' && item.id === 'watchlist') ? 'page' : undefined} key={item.id}><item.icon size={21}/><span>{item.id === 'analysis' ? 'Phân tích' : item.id === 'screener' ? 'Tín hiệu' : item.id === 'watchlist' ? 'Theo dõi' : item.id === 'settings' ? 'Giới thiệu' : item.label}</span></a>) : <>{primaryMobile.map(item => <a className={(activePage === item.id || activePage === 'watchlist-board' && item.id === 'watchlist') ? 'active' : ''} href={`#${item.id}`} aria-label={item.label} aria-current={(activePage === item.id || activePage === 'watchlist-board' && item.id === 'watchlist') ? 'page' : undefined} key={item.id}><item.icon size={21}/><span>{item.id === 'analysis' ? 'Phân tích' : item.id === 'screener' ? 'Tín hiệu' : item.id === 'watchlist' ? 'Theo dõi' : item.label}</span></a>)}<button className={moreOpen || moreMobile.some(item => item.id === activePage) ? 'active' : ''} onClick={() => setMoreOpen(true)} aria-label="Thêm công cụ" aria-expanded={moreOpen}><Menu size={21}/><span>Thêm</span></button></>}</nav>
    {moreOpen && <div className="sheet-backdrop" onMouseDown={() => setMoreOpen(false)}><section ref={moreRef} tabIndex={-1} className="bottom-sheet" role="dialog" aria-modal="true" aria-label="Mở thêm công cụ" onMouseDown={event => event.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><h2>Mở thêm công cụ</h2><button className="icon-button" onClick={() => setMoreOpen(false)} aria-label="Đóng"><X size={20}/></button></div><div className="sheet-grid">{[...moreMobile,{id:'admin',icon:ShieldCheck,label:'Quản trị'}].map(item => <a href={`#${item.id}`} key={item.id}><span><item.icon size={21}/></span><strong>{item.label}</strong><small>{item.id === 'admin' ? 'Tài khoản và phiên' : item.id === 'settings' ? 'Giới thiệu và hệ thống' : 'Công cụ'}</small></a>)}</div></section></div>}
    {accountOpen && <div className="sheet-backdrop" onMouseDown={closeAccount}><section ref={accountRef} className="bottom-sheet account-sheet" role="dialog" aria-modal="true" aria-labelledby="account-title" tabIndex={-1} onMouseDown={e => e.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><div><h2 id="account-title">{profile?.full_name || profile?.username || 'Tài khoản'}</h2><p>Prot Stock v{appVersion}</p></div><button className="icon-button" onClick={closeAccount} aria-label="Đóng tài khoản"><X size={20}/></button></div><div className="account-sheet-theme"><span>Giao diện sáng / tối</span><ThemeToggle/></div><div className="sheet-grid">{permittedModules.filter(item => !['today', 'watchlist', 'journal'].includes(item.id)).map(item => <a href={`#${item.id}`} key={item.id}><span><item.icon size={21}/></span><strong>{item.label}</strong></a>)}</div>{signoutError && <p className="negative" role="alert">Chưa đăng xuất được. Hãy thử lại.</p>}<button className="secondary-button account-signout" onClick={() => void signOut()} disabled={!authenticated}><LogOut size={17}/>Đăng xuất</button></section></div>}
    <CommandPalette symbols={symbols.data ?? []} allowedRoutes={[...permittedModules.map(item => item.id), ...(permittedModules.some(item => item.id === 'watchlist') ? ['watchlist-board'] : [])]}/>
  </div>
}

function LoadingPage() { return <div className="skeleton-page"><div className="skeleton skeleton-title"/><div className="skeleton skeleton-card"/><div className="skeleton-grid">{[1,2,3,4].map(i => <div className="skeleton" key={i}/>)}</div></div> }
function useMarketContext() {
  return useQuery({ queryKey: ['dashboard-vnindex'], enabled: Boolean(supabase), staleTime: 60_000, refetchInterval: 60_000, queryFn: async () => {
    const publication = await latestSignalPublication()
    if (!publication) return { latest: null, change: null, breadth: null }
    const { data: index, error: indexError } = await supabase!.from('market_indices').select('id').eq('code', 'VNINDEX').single()
    if (indexError) throw indexError
    const [{ data: latest, error: latestError }, { data: prior, error: priorError }, { data: breadth, error: breadthError }] = await Promise.all([
      supabase!.from('market_index_prices').select('trading_date,close,source,collected_at').eq('index_id', index.id).eq('trading_date', publication.date).maybeSingle(),
      supabase!.from('market_index_prices').select('trading_date,close').eq('index_id', index.id).lt('trading_date', publication.date).order('trading_date', { ascending: false }).limit(1).maybeSingle(),
      supabase!.from('market_breadth_snapshots').select('trading_date,pct_above_sma50,pct_above_sma20,pct_above_sma200,pct_ma_stack,market_health_score,market_health_state,sample_size,universe_size,eligible_count,observed_count,coverage_ratio,coverage_status,vnindex_trend_state,advance_count,decline_count,unchanged_count,advance_decline_ratio,new_high20_count,new_low20_count,up_down_volume_ratio,sector_breadth,health_method_version,health_components,calculated_at').eq('trading_date', publication.date).maybeSingle(),
    ])
    if (latestError || priorError || breadthError) throw latestError || priorError || breadthError
    const change = latest && prior ? ((Number(latest.close) - Number(prior.close)) / Number(prior.close)) * 100 : null
    return { latest, change, breadth }
  } })
}
function MarketContextCard() {
  const market = useMarketContext()
  const data = market.data
  const state = data?.breadth?.vnindex_trend_state ?? 'UNKNOWN'
  const healthState = data?.breadth?.market_health_state ?? 'UNKNOWN'
  const healthScore = data?.breadth?.market_health_score == null ? '—' : Number(data.breadth.market_health_score).toFixed(1)
  const healthLabel = healthState === 'RISK_ON' ? 'Tích cực' : healthState === 'RISK_OFF' ? 'Phòng thủ' : healthState === 'NEUTRAL' ? 'Trung tính' : 'Chưa đủ dữ liệu'
  const breadthMetric = (value:any) => value == null ? '—' : `${Number(value).toFixed(1)}%`
  const sectorLeaders = Array.isArray(data?.breadth?.sector_breadth) && ['COMPLETE', 'DEGRADED'].includes(data?.breadth?.coverage_status) ? data.breadth.sector_breadth.filter((item:any) => item?.sample_size >= 5 && (item?.coverage_ratio ?? 1) >= 0.8).sort((a:any,b:any) => Number(b.market_health_score ?? -1) - Number(a.market_health_score ?? -1)).slice(0, 4) : []
  const stateLabel = market.isError ? 'CHƯA TẢI ĐƯỢC' : state === 'UP' ? 'UPTREND' : state === 'DOWN' ? 'DOWNTREND' : state === 'SIDEWAYS' ? 'NEUTRAL' : market.isLoading ? 'ĐANG TẢI' : 'CHƯA ĐỦ DỮ LIỆU'
  const hasUsableBreadth = data?.breadth?.coverage_status === 'COMPLETE' || data?.breadth?.coverage_status === 'DEGRADED'
  const isRiskOff = !hasUsableBreadth || state === 'DOWN' || (data?.breadth?.pct_above_sma50 != null && Number(data.breadth.pct_above_sma50) < 35)
  const breadthPct = data?.breadth?.pct_above_sma50 == null ? '—' : `${Number(data.breadth.pct_above_sma50).toFixed(1)}%`
  const coverageStatus = data?.breadth?.coverage_status ?? 'LEGACY'
  const coverageLabel = coverageStatus === 'COMPLETE' ? 'Đầy đủ' : coverageStatus === 'DEGRADED' ? 'Gần đầy đủ' : coverageStatus === 'INCOMPLETE' ? 'Thiếu dữ liệu' : coverageStatus === 'BOOTSTRAP' ? 'Đang tạo mẫu' : 'Dữ liệu lịch sử'
  const observed = data?.breadth?.observed_count ?? data?.breadth?.sample_size ?? 0
  const eligible = data?.breadth?.eligible_count ?? data?.breadth?.sample_size ?? 0
  const coveragePct = data?.breadth?.coverage_ratio == null ? null : Number(data.breadth.coverage_ratio) * 100
  return <details className="market-context-card panel">
    <summary>
      <div className="market-context-heading"><strong>VN-Index · {market.isLoading ? 'Đang tải…' : formatDate(data?.latest?.trading_date ?? data?.breadth?.trading_date)}</strong><small>EOD · {data?.latest?.source?.replace('VNSTOCK_', '') ?? '—'}</small></div>
      <div className="market-context-price"><b>{data?.latest ? Number(data.latest.close).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</b><span className={data?.change != null && data.change < 0 ? 'negative' : 'positive'}>{data?.change == null ? '—' : `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}%`}</span></div>
      <span className={`market-regime ${state.toLowerCase()}`}>{stateLabel}</span><ChevronDown className="market-context-chevron" size={18}/>
    </summary>
    <div className="market-context-detail">{market.isError&&<p role="alert">Chưa tải được bối cảnh thị trường. <button className="text-button" onClick={()=>void market.refetch()}>Thử lại</button></p>}
      <div><span>Prot Universe Breadth · SMA50</span><strong>{breadthPct}</strong><small>{observed}/{eligible} mã đủ điều kiện</small></div>
      <div><span>Độ bao phủ dữ liệu</span><strong className={coverageStatus === 'INCOMPLETE' ? 'negative' : 'positive'}>{coverageLabel}</strong><small>{coveragePct == null ? 'Chưa đủ lịch sử để đánh giá' : `${coveragePct.toFixed(1)}% mẫu đủ điều kiện đã quan sát`}</small></div>
      <div><span>Market Health v1.0</span><strong className={healthState === 'RISK_OFF' ? 'negative' : 'positive'}>{healthScore} · {healthLabel}</strong><small>SMA20 {breadthMetric(data?.breadth?.pct_above_sma20)} · SMA50 {breadthPct} · SMA200 {breadthMetric(data?.breadth?.pct_above_sma200)}</small></div><div><span>Độ sâu thị trường</span><strong>{data?.breadth?.advance_count ?? '—'} tăng / {data?.breadth?.decline_count ?? '—'} giảm</strong><small>Đỉnh/đáy 20 phiên: {data?.breadth?.new_high20_count ?? '—'} / {data?.breadth?.new_low20_count ?? '—'} · KL tăng/giảm: {data?.breadth?.up_down_volume_ratio == null ? '—' : `${Number(data.breadth.up_down_volume_ratio).toFixed(2)}x`}</small></div><div><span>Ngành khỏe nhất</span><strong>{sectorLeaders.length ? sectorLeaders.map((item:any) => `${item.sector} ${Number(item.market_health_score).toFixed(0)}`).join(' · ') : 'Chưa có ngành đủ mẫu'}</strong><small>Chỉ xếp hạng nhóm có ≥5 mã quan sát và độ phủ ≥80%.</small></div><div><span>Market Gate</span><strong className={isRiskOff ? 'negative' : 'positive'}>{!hasUsableBreadth ? 'Chặn mua mới' : isRiskOff ? 'Thận trọng' : 'Cho phép setup'}</strong><small>{!hasUsableBreadth ? 'Market Health vẫn tính trên mã có dữ liệu; độ phủ thấp nên tín hiệu mua hạ WATCH.' : isRiskOff ? 'Tín hiệu mua có thể bị hạ xuống WATCH.' : 'Không có chặn mua từ bối cảnh thị trường.'}</small></div>
      <HealthMethodDetails components={data?.breadth?.health_components} version={data?.breadth?.health_method_version}/>
      <p>Độ rộng, A/D, đỉnh/đáy và khối lượng chỉ đo trên Prot Trading Universe; không đại diện toàn bộ thị trường Việt Nam. Card này là bối cảnh cho Prot Core Engine; biểu đồ VN-Index chuyên sâu vẫn nên xem tại FireAnt, 24HMoney hoặc TradingView.</p>
    </div>
  </details>
}
function ExecutiveKpiStrip({ favorites }: { favorites: string[] }) {
  const summary = useQuery({
    queryKey: ['overview-signal-summary', favorites.join(',')], enabled: Boolean(supabase), staleTime: 60_000, refetchInterval: 60_000,
    queryFn: async () => {
      const publication = await latestSignalPublication()
      if (!publication) return { total: 0, high: 0, watched: 0, date: null }
      const [high, watched] = await Promise.all([
        supabase!.from('consolidated_signals').select('id', { count: 'exact', head: true }).eq('as_of_date', publication.date).eq('source_revision', publication.sourceRevision).gte('confluence_count', 2),
        favorites.length ? supabase!.from('consolidated_signals').select('symbols!inner(symbol)').eq('as_of_date', publication.date).eq('source_revision', publication.sourceRevision).neq('composite_action', 'WATCH').in('symbols.symbol', favorites).range(0, 999) : Promise.resolve({ data: [], error: null }),
      ])
      if (high.error || watched.error) throw high.error || watched.error
      const tracked = new Set((watched.data ?? []).map((item: any) => (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol).filter(Boolean))
      return { total: publication.count, high: high.count ?? 0, watched: tracked.size, date: publication.date }
    },
  })
  return <section className="overview-kpis" aria-label="Tóm tắt phiên gần nhất">
    <article className="overview-kpi"><span className="overview-kpi-label">TÍN HIỆU EOD v1.0</span><strong>{summary.data?.total ?? '—'}</strong><small>{summary.data ? `${summary.data.high} đồng thuận cao · ${formatDate(summary.data.date)}` : !supabase ? 'Chưa kết nối dữ liệu' : summary.isError ? 'Chưa tải được tín hiệu' : 'Đang tải…'}</small></article>
    <article className="overview-kpi"><span className="overview-kpi-label">THEO DÕI</span><strong>{favorites.length}</strong><small>{summary.data ? `${summary.data.watched} mã có tín hiệu hành động` : !supabase ? 'Chưa kết nối dữ liệu' : summary.isError ? 'Chưa tải được tín hiệu' : 'Đang tải tín hiệu watchlist…'}</small></article>
  </section>
}
function Dashboard({ syncStatus }: { syncStatus: 'loading' | 'ready' | 'error' }) {
  const watchlist = useWatchlist().filter(isWatchActive)
  const favorites = watchlist.map(item => item.symbol)
  const selectSymbol = (symbol: string) => {
    localStorage.setItem('protstock-symbol', symbol)
    dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol }))
  }
  return <section className="dashboard-page overview-page">
    <header className="dashboard-header overview-header">
      <div><h1>Tổng quan</h1><p>Thị trường, tín hiệu và danh sách đang theo dõi.</p></div>
      <a href="#screener" className="primary-button"><TrendingUp size={16}/> Mở bộ lọc</a>
    </header>
    <MarketContextCard/>
    <ExecutiveKpiStrip favorites={favorites}/>
    <SignalDecisionBoard onSelect={selectSymbol}/>
    <section className="overview-support-grid">
        <article className="panel overview-watch-card">
          <div className="overview-card-heading"><div><h2>Watchlist <small>{favorites.length} mã</small></h2></div><a className="text-button" href="#watchlist">Mở Watchlist</a></div>
          {syncStatus === 'error' && <p className="watchlist-sync-warning" role="status">Chưa đồng bộ được với tài khoản. Thay đổi trên thiết bị này có thể chưa xuất hiện ở thiết bị khác.</p>}
          <div className="overview-watch-list">{watchlist.length ? watchlist.slice(0, 8).map(item => <a href="#analysis" className="overview-watch-row" key={item.symbol} onClick={() => selectSymbol(item.symbol)}><strong>{item.symbol}</strong><span>Tier {item.tier} · Xem phân tích</span></a>) : <p className="overview-empty">Chưa có mã nào. <a href="#watchlist">Tạo Watchlist</a></p>}</div>
        </article>
        <TodayHealth/>
    </section>
  </section>
}
export default App
