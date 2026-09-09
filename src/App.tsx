import { lazy, Suspense, useEffect, useState } from 'react'
import { useDataHealth } from './hooks/useDataHealth'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const AnalysisPage = lazy(() => import('./components/AnalysisPage').then(module => ({ default: module.AnalysisPage })))

const modules = [
  { id: 'today', icon: '⌁', label: 'Tổng quan' },
  { id: 'analysis', icon: '⌕', label: 'Phân tích mã' },
  { id: 'screener', icon: '◇', label: 'Screener' },
  { id: 'rules', icon: '⎇', label: 'Rules' },
  { id: 'backtest', icon: '↗', label: 'Backtest' },
  { id: 'portfolio', icon: '▱', label: 'Danh mục' },
  { id: 'journal', icon: '✎', label: 'Nhật ký' },
]

function currentPage() {
  const value = window.location.hash.replace('#', '')
  return modules.some(item => item.id === value) ? value : 'today'
}

function App({ authenticated = false }: { authenticated?: boolean }) {
  const [page, setPage] = useState(currentPage)
  const health = useDataHealth(authenticated)
  useEffect(() => {
    const update = () => setPage(currentPage())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const universeCount = health.data?.active_symbols ?? 205
  const connectionLabel = !isSupabaseConfigured ? 'Preview · chưa gắn Supabase' : health.isLoading ? 'Đang đồng bộ dữ liệu' : health.isError ? 'Dữ liệu chưa sẵn sàng' : 'Supabase đã kết nối'

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#today" aria-label="Prot Stock"><span className="brand-mark">P</span><span>Prot Stock</span></a>
      <nav aria-label="Điều hướng chính">
        {modules.map(item => <a className={page === item.id ? 'nav-item active' : 'nav-item'} href={`#${item.id}`} key={item.id}><span aria-hidden="true">{item.icon}</span>{item.label}</a>)}
      </nav>
      <div className="sidebar-note"><span className="live-dot" />Phase 2 đang triển khai<small>Indicators · Patterns · Chart</small></div>
      <button className="signout" onClick={() => supabase?.auth.signOut()}>Đăng xuất</button>
    </aside>
    <main id="top">
      {page === 'today' && <Dashboard universeCount={universeCount} connectionLabel={connectionLabel} health={health.data} />}
      {page === 'analysis' && <Suspense fallback={<div className="empty-state">Đang mở biểu đồ…</div>}><AnalysisPage authenticated={authenticated} /></Suspense>}
      {!['today', 'analysis'].includes(page) && <ComingSoon page={modules.find(item => item.id === page)?.label ?? page} />}
      <footer>Prot Stock · Personal research system · Không phải khuyến nghị đầu tư</footer>
    </main>
  </div>
}

function Dashboard({ universeCount, connectionLabel, health }: { universeCount: number, connectionLabel: string, health?: { latest_price_date: string | null, failed_jobs_7d: number } }) {
  return <>
    <header><div><span className="eyebrow">EOD INTELLIGENCE</span><h1>Chào Prot.</h1><p>Không gian phân tích riêng cho 205 cổ phiếu Việt Nam.</p></div><div className="market-badge"><span /> {connectionLabel}</div></header>
    <section className="hero-grid" aria-label="Trạng thái hệ thống">
      <article className="feature-card"><div className="card-top"><span>UNIVERSE</span><b>{universeCount}</b></div><h2>Danh sách đã khóa</h2><p>205 mã duy nhất · TDC thuộc BDS_KCN · có cơ chế mở rộng có kiểm soát.</p><div className="ticker-line">{['FPT','HPG','MBB','VNM','TDC'].map(ticker => <span key={ticker}>{ticker}</span>)}</div></article>
      <article className="feature-card accent"><div className="card-top"><span>PIPELINE</span><b>D · W · M</b></div><h2>Phân tích sau phiên</h2><p>Phiên dữ liệu mới nhất: {health?.latest_price_date ?? 'chưa chạy EOD'}. Job lỗi 7 ngày: {health?.failed_jobs_7d ?? 0}.</p><div className="signal-preview"><i /> Giá <strong>→</strong> Khối lượng <strong>→</strong> Mẫu hình <strong>→</strong> Rule</div></article>
    </section>
    <section className="roadmap"><div className="section-heading"><div><span className="eyebrow">BUILD STATUS</span><h2>Lộ trình tinh gọn</h2></div><span className="phase-pill">Phase 2 · In progress</span></div>
      <div className="phase-list">{[
        ['01','Nền tảng dữ liệu','Hoàn tất'],['02','Phân tích & mẫu hình','Đang triển khai'],['03','Screener & rules','Kế tiếp'],['04','Backtest','Đã đặc tả'],['05','Danh mục & nhật ký','Đã đặc tả'],
      ].map(([number,title,status]) => <article className="phase-row" key={number}><span className="phase-number">{number}</span><h3>{title}</h3><span>{status}</span></article>)}</div>
    </section>
  </>
}

function ComingSoon({ page }: { page: string }) {
  return <section className="workspace-page"><span className="eyebrow">NEXT PHASE</span><h1>{page}</h1><div className="empty-state">Module này đã có đặc tả và sẽ được mở ngay sau khi Phase 2 vượt kiểm thử dữ liệu.</div></section>
}

export default App
