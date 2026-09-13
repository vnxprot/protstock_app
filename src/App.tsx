import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Bell, BookOpen, BriefcaseBusiness, ChevronDown, ChevronLeft, Command, FlaskConical, LayoutDashboard, Menu, Search, Settings, TrendingUp, Workflow, X } from 'lucide-react'
import { useDataHealth, type DataHealth } from './hooks/useDataHealth'
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
  const navCounts = useQuery({ queryKey: ['nav-counts'], enabled: authenticated && Boolean(supabase), queryFn: async () => { const [latestSignal, rules] = await Promise.all([supabase!.from('consolidated_signals').select('as_of_date').order('as_of_date', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle(), supabase!.from('rules').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE')]); if (latestSignal.error || rules.error) throw latestSignal.error || rules.error; const latestDate = latestSignal.data?.as_of_date; if (!latestDate) return { signals: 0, rules: rules.count ?? 0 }; const { count, error } = await supabase!.from('consolidated_signals').select('id', { count: 'exact', head: true }).eq('as_of_date', latestDate); if (error) throw error; return { signals: count ?? 0, rules: rules.count ?? 0 } } })
  const navigation = modules.map(item => ({ ...item, badge: item.id === 'screener' ? navCounts.data?.signals : item.id === 'rules' ? navCounts.data?.rules : undefined }))
  useEffect(() => { const update = () => { setPage(currentPage()); setMoreOpen(false); scrollTo({ top: 0, behavior: 'smooth' }) }; addEventListener('hashchange', update); return () => removeEventListener('hashchange', update) }, [])
  const connectionLabel = !isSupabaseConfigured ? 'Chưa kết nối Supabase' : health.isLoading ? 'Đang đồng bộ' : health.isError ? 'Pipeline cần kiểm tra' : 'Pipeline EOD trực tuyến'
  const pages: Record<string, React.ReactNode> = { analysis: <AnalysisPage authenticated={authenticated}/>, screener: <ScreenerPage authenticated={authenticated}/>, rules: <RuleBuilderPage authenticated={authenticated}/>, backtest: <BacktestPage authenticated={authenticated}/>, portfolio: <PortfolioPage authenticated={authenticated}/>, journal: <JournalPage authenticated={authenticated}/>, settings: <SettingsPage authenticated={authenticated}/> }
  return <div className={collapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
    <aside className="sidebar"><div className="sidebar-head"><a className="brand" href="#today"><span className="brand-mark">P</span><span className="brand-copy">Prot<span>Stock</span></span></a><button className="icon-button collapse-button" onClick={() => setCollapsed(v => !v)} aria-label="Thu gọn thanh bên"><ChevronLeft size={18}/></button></div><nav aria-label="Điều hướng chính">{navigation.map(item => <a className={page === item.id ? 'nav-item active' : 'nav-item'} data-tooltip={item.label} href={`#${item.id}`} key={item.id}><item.icon size={19}/><span className="nav-label">{item.label}</span>{item.badge != null && <small className="nav-badge">{item.badge}</small>}</a>)}</nav><div className="sidebar-note"><span className="live-dot"/><span className="sidebar-note-copy">Pipeline EOD ổn định</span></div><button className="signout" onClick={() => supabase?.auth.signOut()}><span className="nav-label">Đăng xuất</span></button></aside>
    <main id="top"><div className="topbar"><button className="command-trigger" onClick={() => openCommandPalette()}><Search size={17}/><span>Tìm mã hoặc chức năng…</span><kbd><Command size={12}/> K</kbd></button><div className="topbar-actions"><div className="status-chip"><span className="live-dot"/>{connectionLabel}</div><button className="icon-button notification" aria-label="Thông báo"><Bell size={18}/><i/></button></div></div><div className="mobile-header"><a className="brand" href="#today"><span className="brand-mark">P</span><span className="brand-copy">Prot<span>Stock</span></span></a><div><button className="icon-button" onClick={() => openCommandPalette()}><Search size={19}/></button><span className="mobile-live"><span className="live-dot"/>EOD</span></div></div>
      {page === 'today' ? <Dashboard connectionLabel={connectionLabel} health={health.data}/> : <Suspense fallback={<LoadingPage/>}>{pages[page]}</Suspense>}<footer className="app-footer">Prot Stock · Hệ thống nghiên cứu cá nhân · Không phải khuyến nghị đầu tư</footer></main>
    <nav className="bottom-nav">{primaryMobile.map(item => <a className={page === item.id ? 'active' : ''} href={`#${item.id}`} key={item.id}><item.icon size={21}/><span>{item.label === 'Phân tích mã' ? 'Phân tích' : item.label}</span></a>)}<button className={moreOpen || moreMobile.some(item => item.id === page) ? 'active' : ''} onClick={() => setMoreOpen(true)}><Menu size={21}/><span>Thêm</span></button></nav>
    {moreOpen && <div className="sheet-backdrop" onMouseDown={() => setMoreOpen(false)}><section className="bottom-sheet" onMouseDown={e => e.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><div><span className="eyebrow">WORKSPACE</span><h2>Mở thêm công cụ</h2></div><button className="icon-button" onClick={() => setMoreOpen(false)}><X size={20}/></button></div><div className="sheet-grid">{moreMobile.map(item => <a href={`#${item.id}`} key={item.id}><span><item.icon size={21}/></span><strong>{item.label}</strong><small>{item.id === 'rules' ? 'Thiết kế điều kiện' : item.id === 'backtest' ? 'Kiểm chứng lịch sử' : item.id === 'journal' ? 'Ghi và review' : 'Hệ thống'}</small></a>)}</div></section></div>}
    <CommandPalette symbols={symbols.data ?? []}/>
  </div>
}

function LoadingPage() { return <div className="skeleton-page"><div className="skeleton skeleton-title"/><div className="skeleton skeleton-card"/><div className="skeleton-grid">{[1,2,3,4].map(i => <div className="skeleton" key={i}/>)}</div></div> }
function useMarketContext() {
  return useQuery({ queryKey: ['dashboard-vnindex'], enabled: Boolean(supabase), staleTime: 60_000, queryFn: async () => {
    const { data: index, error: indexError } = await supabase!.from('market_indices').select('id').eq('code', 'VNINDEX').single()
    if (indexError) throw indexError
    const [{ data: prices, error: pricesError }, { data: breadth, error: breadthError }] = await Promise.all([
      supabase!.from('market_index_prices').select('trading_date,close,source,collected_at').eq('index_id', index.id).order('trading_date', { ascending: false }).limit(2),
      supabase!.from('market_breadth_snapshots').select('trading_date,pct_above_sma50,sample_size,vnindex_trend_state,calculated_at').order('trading_date', { ascending: false }).limit(1),
    ])
    if (pricesError || breadthError) throw pricesError || breadthError
    const latest = prices?.[0]
    const prior = prices?.[1]
    const change = latest && prior ? ((Number(latest.close) - Number(prior.close)) / Number(prior.close)) * 100 : null
    return { latest, change, breadth: breadth?.[0] }
  } })
}
function MarketContextCard() {
  const market = useMarketContext()
  const data = market.data
  const state = data?.breadth?.vnindex_trend_state ?? 'UNKNOWN'
  const stateLabel = state === 'UP' ? 'UPTREND' : state === 'DOWN' ? 'DOWNTREND' : state === 'SIDEWAYS' ? 'NEUTRAL' : 'ĐANG ĐỒNG BỘ'
  const isRiskOff = state === 'DOWN' || (data?.breadth?.pct_above_sma50 != null && Number(data.breadth.pct_above_sma50) < 35)
  const breadthPct = data?.breadth?.pct_above_sma50 == null ? '—' : `${Number(data.breadth.pct_above_sma50).toFixed(1)}%`
  return <details className="market-context-card panel">
    <summary>
      <div className="market-context-heading"><span className="eyebrow">THỊ TRƯỜNG · VNINDEX</span><strong>{market.isLoading ? 'Đang tải thị trường…' : formatDate(data?.latest?.trading_date ?? data?.breadth?.trading_date)}</strong><small>EOD · {data?.latest?.source?.replace('VNSTOCK_', '') ?? '—'}</small></div>
      <div className="market-context-price"><b>{data?.latest ? Number(data.latest.close).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</b><span className={data?.change != null && data.change < 0 ? 'negative' : 'positive'}>{data?.change == null ? '—' : `${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}%`}</span></div>
      <span className={`market-regime ${state.toLowerCase()}`}>{stateLabel}</span><ChevronDown className="market-context-chevron" size={18}/>
    </summary>
    <div className="market-context-detail">
      <div><span>Breadth trên SMA50</span><strong>{breadthPct}</strong><small>{data?.breadth?.sample_size ?? 0} mã có dữ liệu</small></div>
      <div><span>Market Gate</span><strong className={isRiskOff ? 'negative' : 'positive'}>{isRiskOff ? 'Thận trọng' : 'Cho phép setup'}</strong><small>{isRiskOff ? 'Tín hiệu mua có thể bị hạ xuống WATCH.' : 'Không có chặn mua từ bối cảnh thị trường.'}</small></div>
      <p>Card này chỉ hiển thị bối cảnh dùng trực tiếp bởi Prot Core Engine; biểu đồ VNINDEX chuyên sâu vẫn nên xem tại FireAnt, 24HMoney hoặc TradingView.</p>
    </div>
  </details>
}
function ExecutiveKpiStrip({ favorites, connectionLabel, health }: { favorites: string[]; connectionLabel: string; health?: DataHealth }) {
  const market = useMarketContext()
  const summary = useQuery({
    queryKey: ['overview-signal-summary', favorites.join(',')], enabled: Boolean(supabase), staleTime: 60_000,
    queryFn: async () => {
      const { data: latest, error: latestError } = await supabase!.from('consolidated_signals').select('as_of_date').order('as_of_date', { ascending: false }).limit(1).maybeSingle()
      if (latestError) throw latestError
      if (!latest) return { total: 0, high: 0, watched: 0, date: null }
      const [total, high, watched] = await Promise.all([
        supabase!.from('consolidated_signals').select('id', { count: 'exact', head: true }).eq('as_of_date', latest.as_of_date),
        supabase!.from('consolidated_signals').select('id', { count: 'exact', head: true }).eq('as_of_date', latest.as_of_date).gte('confluence_count', 2),
        favorites.length ? supabase!.from('consolidated_signals').select('symbols!inner(symbol)').eq('as_of_date', latest.as_of_date).neq('composite_action', 'WATCH').in('symbols.symbol', favorites).range(0, 999) : Promise.resolve({ data: [], error: null }),
      ])
      if (total.error || high.error || watched.error) throw total.error || high.error || watched.error
      const tracked = new Set((watched.data ?? []).map((item: any) => (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol).filter(Boolean))
      return { total: total.count ?? 0, high: high.count ?? 0, watched: tracked.size, date: latest.as_of_date }
    },
  })
  const state = market.data?.breadth?.vnindex_trend_state ?? 'UNKNOWN'
  const trendLabel = state === 'UP' ? 'UPTREND' : state === 'DOWN' ? 'DOWNTREND' : state === 'SIDEWAYS' ? 'NEUTRAL' : 'CHƯA ĐỦ DỮ LIỆU'
  const change = market.data?.change
  return <section className="overview-kpis" aria-label="Tóm tắt phiên gần nhất">
    <article className="overview-kpi"><span className="overview-kpi-label">VNINDEX</span><strong>{market.data?.latest ? Number(market.data.latest.close).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</strong><div className="overview-kpi-meta"><span className={change != null && change < 0 ? 'negative' : 'positive'}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}</span><span className={`market-regime ${state.toLowerCase()}`}>{trendLabel}</span></div></article>
    <article className="overview-kpi"><span className="overview-kpi-label">TÍN HIỆU EOD</span><strong>{summary.data?.total ?? '—'}</strong><small>{summary.data ? `${summary.data.high} đồng thuận cao · ${formatDate(summary.data.date)}` : summary.isError ? 'Chưa tải được tín hiệu' : 'Đang tải…'}</small></article>
    <article className="overview-kpi"><span className="overview-kpi-label">PIPELINE</span><strong className={connectionLabel.includes('trực tuyến') ? 'positive' : ''}>{connectionLabel.includes('trực tuyến') ? 'ONLINE' : connectionLabel.includes('Đang') ? 'ĐANG TẢI' : 'CẦN KIỂM TRA'}</strong><small>{health ? `${health.active_symbols} mã · ${formatDate(health.latest_price_date)}` : connectionLabel}</small></article>
    <article className="overview-kpi"><span className="overview-kpi-label">WATCHLIST</span><strong>{favorites.length}</strong><small>{summary.data ? `${summary.data.watched} mã có tín hiệu hành động` : 'Đang tải tín hiệu watchlist…'}</small></article>
  </section>
}
function Dashboard({ connectionLabel, health }: { connectionLabel: string; health?: DataHealth }) {
  const signals = useQuery({
    queryKey: ['today-consolidated-signals'], enabled: Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!.from('consolidated_signals')
        .select('id,composite_action,confluence_score,confluence_count,timeframe,as_of_date,reasons,symbols(symbol,sector)')
        .order('as_of_date', { ascending: false }).order('confluence_score', { ascending: false }).limit(6)
      if (error) throw error
      return (data ?? []).map((item: any) => {
        const symbol = Array.isArray(item.symbols) ? item.symbols[0] : item.symbols
        return { ...item, symbol: symbol?.symbol ?? '—', sector: symbol?.sector, action: item.composite_action, score: Number(item.confluence_score), count: Number(item.confluence_count) }
      })
    },
  })
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('protstock-favorites') ?? '[]') } catch { return [] } })
  useEffect(() => {
    const update = (event: Event) => setFavorites((event as CustomEvent<string[]>).detail)
    addEventListener('protstock:favorites', update)
    return () => removeEventListener('protstock:favorites', update)
  }, [])
  const feed = signals.data ?? []
  const actionLabels: Record<string, string> = { PROBE_BUY: 'Mua thăm dò', ADD: 'Mua thêm', REDUCE: 'Giảm tỷ trọng', EXIT: 'Thoát lệnh', WATCH: 'Theo dõi' }
  const selectSymbol = (symbol: string) => {
    localStorage.setItem('protstock-symbol', symbol)
    dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol }))
  }
  return <section className="dashboard-page overview-page">
    <header className="dashboard-header overview-header">
      <div><span className="eyebrow">EOD INTELLIGENCE</span><h1>Tổng quan</h1><p>Thị trường, tín hiệu và danh sách đang theo dõi.</p></div>
      <a href="#screener" className="primary-button"><TrendingUp size={16}/> Mở Screener</a>
    </header>
    <ExecutiveKpiStrip favorites={favorites} connectionLabel={connectionLabel} health={health}/>
    <section className="overview-layout dashboard-grid"><div className="overview-main"><MarketContextCard/>
      <article className="panel overview-signals-card">
        <div className="overview-card-heading"><div><span className="eyebrow">TÍN HIỆU SAU PHIÊN</span><h2>Tín hiệu gần nhất</h2></div><a href="#screener">Xem tất cả →</a></div>
        <div className="overview-signal-list">
          {signals.isLoading ? <p className="overview-empty">Đang tải tín hiệu…</p> : signals.isError ? <p className="overview-empty negative">Chưa tải được tín hiệu. Vui lòng thử lại.</p> : feed.length ? feed.map(item =>
            <a href="#analysis" className="overview-signal-row" key={item.id} onClick={() => selectSymbol(item.symbol)}>
              <div className="overview-signal-top">
                <div className="overview-signal-identity"><span className="overview-ticker-avatar" aria-hidden="true">{item.symbol.slice(0, 2)}</span><strong>{item.symbol}</strong><span className={`action-pill ${item.action.toLowerCase()}`}>{actionLabels[item.action] ?? item.action}</span></div>
                <div className="overview-signal-values"><b className="overview-score-gauge">{item.score}<small>/100</small></b><time>{formatDate(item.as_of_date)}</time></div>
              </div>
              <div className="overview-signal-bottom"><span>{item.sector ?? 'Chưa phân ngành'} · {item.timeframe} · {item.count} engine<span className={`overview-consensus confluence-badge ${item.count >= 3 ? 'strong_aligned' : item.count === 2 ? 'high_confluence' : 'standard'}`}>{item.count >= 3 ? 'Đồng thuận mạnh' : item.count === 2 ? 'Đồng thuận cao' : 'Tiêu chuẩn'}</span></span><span className="overview-chart-link">Xem chart →</span></div>
            </a>
          ) : <p className="overview-empty">Chưa có tín hiệu sau phiên.</p>}
        </div>
      </article>
      </div><aside className="overview-side">
        <TodayHealth/>
        <article className="panel overview-watch-card">
          <div className="overview-card-heading"><div><span className="eyebrow">WATCHLIST · {favorites.length} MÃ</span><h2>Đang theo dõi</h2></div><button type="button" className="text-button" onClick={() => openCommandPalette('symbols')}>+ Thêm mã</button></div>
          <div className="overview-watch-list">{favorites.length ? favorites.map(symbol => <a href="#analysis" className="overview-watch-row" key={symbol} onClick={() => selectSymbol(symbol)}><strong>{symbol}</strong><span>Xem phân tích →</span></a>) : <p className="overview-empty">Chưa có mã nào trong watchlist.</p>}</div>
        </article>
      </aside>
    </section>
  </section>
}
export default App

