import './VersionHistory.css'

const foundation = {
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

const releases = [{
  version: '1.0.0',
  date: '18/11/2026',
  title: 'Dữ liệu thị trường SSI',
  areas: [
    { name: 'Dữ liệu', changes: [
      'SSI FastConnect được ưu tiên theo từng mã đủ chuỗi giá ngày từ 2021. Vietcap và KBS phục vụ các mã đang chờ chuyển.',
      'Giao dịch khối ngoại ưu tiên SSI. Số liệu tự doanh tiếp tục lấy từ báo cáo theo từng sàn.',
    ] },
    { name: 'Radar dòng tiền', changes: [
      'Băng SSI đủ phiên được ưu tiên; Vietcap bổ sung theo từng mã và phiên. Khớp định kỳ được hiển thị riêng.',
      'Bộ thu trong giờ công bố mỗi 15 phút. Bản xem lại giữ độ phân giải 1 phút trong 5 phiên gần nhất.',
    ] },
    { name: 'Tín hiệu và nghiên cứu', changes: [
      'Tín hiệu mới dùng dữ liệu của phiên công bố. Lịch sử tín hiệu giữ ngày và phiên bản phép tính.',
      'Giá CANSLIM dùng chuỗi SSI khi mã đã chuyển. Dữ liệu tài chính tiếp tục dùng báo cáo hiện có.',
    ] },
  ],
}, foundation] as const

export function VersionHistory({ currentVersion }: { currentVersion: string }) {
  return <div className="version-history"><div className="version-intro panel"><h2>Phiên bản Prot Stock</h2><p>Đang dùng <strong>v{currentVersion}</strong>.</p></div>
    {releases.map(release => <article key={release.version} className="panel version-release">
      <header><div><span className="version-pill">v{release.version}</span><h3>{release.title}</h3></div><time>{release.date}</time></header>
      <div className="version-areas">{release.areas.map(area => <section key={area.name}><h4>{area.name}</h4><ul>{area.changes.map(change => <li key={change}>{change}</li>)}</ul></section>)}</div>
    </article>)}
  </div>
}
