const modules = [
  { icon: '⌁', label: 'Tổng quan', active: true },
  { icon: '⌕', label: 'Phân tích mã' },
  { icon: '◇', label: 'Screener' },
  { icon: '⎇', label: 'Rules' },
  { icon: '↗', label: 'Backtest' },
  { icon: '▱', label: 'Danh mục' },
  { icon: '✎', label: 'Nhật ký' },
]

const phases = [
  ['01', 'Nền tảng dữ liệu', 'Đã hoàn tất'],
  ['02', 'Phân tích & mẫu hình', 'Tiếp theo'],
  ['03', 'Screener & rules', 'Đã lên kế hoạch'],
]

function App({ authenticated = false }: { authenticated?: boolean }) {
  const health = useDataHealth(authenticated)
  const universeCount = health.data?.active_symbols ?? 205
  const connectionLabel = !isSupabaseConfigured
    ? 'Preview · chưa gắn Supabase'
    : health.isLoading
      ? 'Đang đồng bộ dữ liệu'
      : health.isError
        ? 'Dữ liệu chưa sẵn sàng'
        : 'Supabase đã kết nối'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Prot Stock">
          <span className="brand-mark">P</span>
          <span>Prot Stock</span>
        </a>
        <nav aria-label="Điều hướng chính">
          {modules.map((item) => (
            <a className={item.active ? 'nav-item active' : 'nav-item'} href={`#${item.label}`} key={item.label}>
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" />
          Phase 0 hoàn tất
          <small>Kiến trúc · Universe · Pattern spec</small>
        </div>
      </aside>

      <main id="top">
        <header>
          <div>
            <span className="eyebrow">EOD INTELLIGENCE</span>
            <h1>Chào Prot.</h1>
            <p>Không gian phân tích riêng cho 205 cổ phiếu Việt Nam.</p>
          </div>
          <div className="market-badge"><span /> {connectionLabel}</div>
        </header>

        <section className="hero-grid" aria-label="Trạng thái hệ thống">
          <article className="feature-card">
            <div className="card-top"><span>UNIVERSE</span><b>{universeCount}</b></div>
            <h2>Danh sách đã khóa</h2>
            <p>205 mã duy nhất · TDC thuộc BDS_KCN · có cơ chế mở rộng sau này.</p>
            <div className="ticker-line">
              {['FPT', 'HPG', 'MBB', 'VNM', 'TDC'].map((ticker) => <span key={ticker}>{ticker}</span>)}
            </div>
          </article>

          <article className="feature-card accent">
            <div className="card-top"><span>PIPELINE</span><b>D · W · M</b></div>
            <h2>Phân tích sau phiên</h2>
            <p>Dữ liệu ngày, tuần, tháng. Không realtime. Mọi tín hiệu đều có lý do và dấu thời gian.</p>
            <div className="signal-preview">
              <i /> Giá <strong>→</strong> Khối lượng <strong>→</strong> Mẫu hình <strong>→</strong> Rule
            </div>
          </article>
        </section>

        <section className="roadmap">
          <div className="section-heading">
            <div><span className="eyebrow">BUILD STATUS</span><h2>Lộ trình tinh gọn</h2></div>
            <span className="phase-pill">Phase 1 · Data live</span>
          </div>
          <div className="phase-list">
            {phases.map(([number, title, status]) => (
              <article className="phase-row" key={number}>
                <span className="phase-number">{number}</span>
                <h3>{title}</h3>
                <span>{status}</span>
              </article>
            ))}
          </div>
        </section>

        <footer>Prot Stock · Personal research system · Không phải khuyến nghị đầu tư</footer>
      </main>
    </div>
  )
}

export default App
import { isSupabaseConfigured } from './lib/supabase'
import { useDataHealth } from './hooks/useDataHealth'
