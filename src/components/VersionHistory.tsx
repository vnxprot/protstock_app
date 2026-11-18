import './VersionHistory.css'

const release = {
  version: '0.0.0',
  date: '14/10/2026',
  title: 'Nền tảng Prot Stock',
  areas: [
    { name: 'Dữ liệu', changes: [
      'VCI trực tiếp là nguồn OHLCV EOD chính cho cổ phiếu và VN-Index; KBS dự phòng theo cả chuỗi.',
      'Giá và khối lượng của nguồn đã chọn được dùng trực tiếp cho mọi phép tính; sự kiện doanh nghiệp không chặn EOD.',
      'Lịch sử dùng dữ liệu có thật từ 01/01/2021 đến phiên gần nhất của từng mã.',
    ] },
    { name: 'Phân tích và tín hiệu', changes: [
      'Core Engine, Core Pack, Prot Flow, Market Health, sức mạnh ngành, Sector Flow và các chỉ báo được tính từ cùng chuỗi giá–khối lượng.',
      'Khung ngày, tuần, tháng giữ logic mẫu hình, vùng giá, Fibonacci, phễu, radar, MACD phân kỳ dương, signals và Watch cơ hội.',
      'Bộ lọc giao dịch đột biến dùng nến phút cùng nguồn với EOD của mã.',
    ] },
    { name: 'Phạm vi', changes: [
      'Universe hiện tại gồm 277 mã.',
      'Prot Stock là ứng dụng cá nhân, phi thương mại.',
    ] },
  ],
} as const

export function VersionHistory({ currentVersion }: { currentVersion: string }) {
  return <div className="version-history"><div className="version-intro panel"><h2>Phiên bản Prot Stock</h2><p>Phiên bản đang dùng: <strong>v{currentVersion}</strong>. Prot Stock bắt đầu lại từ v0.0.0 với các logic phân tích đang dùng.</p></div>
    <article className="panel version-release">
      <header><div><span className="version-pill">v{release.version}</span><h3>{release.title}</h3></div><time>{release.date}</time></header>
      <div className="version-areas">{release.areas.map(area => <section key={area.name}><h4>{area.name}</h4><ul>{area.changes.map(change => <li key={change}>{change}</li>)}</ul></section>)}</div>
    </article>
  </div>
}
