import './VersionHistory.css'

const releases = [
  { version: '3.0.1', date: '09/10/2026', title: 'Hướng dẫn hệ thống và từ điển tra cứu', areas: [
    { name: 'Hướng dẫn', changes: ['Thêm bản đồ từ dữ liệu đến quyết định, lối vào theo chủ đề và quy trình đọc một mã.', 'Tìm kiếm không dấu hoặc có dấu trong bài hướng dẫn và từ điển, với liên kết đến đúng nội dung.'] },
    { name: 'Dữ liệu và tín hiệu', changes: ['Giải thích nguồn, độ phủ, trạng thái công bố và giới hạn dữ liệu lịch sử.', 'Phân biệt Champion, Challenger shadow, sáu bảng tín hiệu và Radar giao dịch đột biến sau phiên.'] },
    { name: 'Từ điển', changes: ['Phân nhóm thuật ngữ, chiến lược, hành động, công thức và cách đọc trong Prot Stock.', 'Giữ chi tiết quy tắc cũ trong khu vực đọc sâu.'] },
  ] },
  { version: '3.0.0', date: '09/10/2026', title: 'Giao diện đồng nhất và rõ trạng thái hơn', areas: [
    { name: 'Giao diện', changes: ['Thống nhất token chữ, khoảng cách, bo góc và kích thước điều khiển.', 'Nút chính nổi bật trong giao diện sáng; Watchlist có màu phù hợp cả hai giao diện.', 'Mã và điểm tín hiệu dễ quét hơn; ngày và ngành giữ vai trò thông tin phụ.'] },
    { name: 'Luồng sử dụng', changes: ['Danh mục ưu tiên nút Giao dịch; trang Phân tích gom bằng chứng kỹ thuật có thể mở rộng.', 'Nội dung mobile chừa chỗ cho thanh điều hướng đáy.'] },
    { name: 'Phản hồi', changes: ['Thông báo phân biệt thành công, cảnh báo và lỗi; nút lưu hiển thị tiến trình.', 'Vòng quay Watchlist có tùy chọn âm thanh và rung, mặc định tắt.'] },
  ] },
  { version: '2.0.2', date: '08/10/2026', title: 'Bản đồ cơ hội dễ đọc hơn', areas: [
    { name: 'Radar cơ hội', changes: ['Hiển thị một hàng tóm tắt mỗi mã, ưu tiên mốc mới và rủi ro điểm vào; số liệu chi tiết nằm trong phần mở rộng.', 'Đối chiếu cùng phiên với tín hiệu Champion/WATCH, Phễu gốc, Phễu Challenger và phân kỳ MACD; mở trực tiếp đúng mã ở từng bảng.', 'Bộ lọc bắt đầu từ Tất cả, tách giai đoạn kỹ thuật khỏi điều kiện rủi ro và nguồn bằng chứng.'] },
    { name: 'Phễu tháng → tuần → ngày', changes: ['Cột rộng hơn, hàng chính một dòng và cuộn ngang trên màn hình hẹp.', 'Diễn giải lý do ngắn gọn; điều kiện kỹ thuật đầy đủ mở theo từng mã.'] },
  ] },
  { version: '2.0.1', date: '08/10/2026', title: 'Theo dõi đà tăng rõ hơn', areas: [
    { name: 'Bộ lọc tín hiệu', changes: ['Thêm Radar đà tăng: phát hiện đột biến giá và khối lượng, breakout ngày, xác nhận tuần, tiếp diễn và tăng tốc lại.', 'Một đợt tăng giữ chung lịch sử sự kiện qua nhiều phiên; tách diễn biến khỏi đánh giá điểm vào và khoảng cách đến stop.'] },
    { name: 'Phễu tháng → tuần → ngày', changes: ['Breakout được xác nhận khi đóng tuần có thể ghi nhận nến trigger của chính ngày đóng tuần.', 'Giữ trigger đã xảy ra của setup còn hiệu lực khi xuất hiện setup tuần mới.'] },
    { name: 'Cài đặt & dữ liệu', changes: ['Thêm mục Phiên bản và diễn giải logic Radar.', 'Lưu các đánh giá Radar theo phiên để theo dõi và đối chiếu; không tự phát sinh lệnh giao dịch.'] },
  ] },
  { version: '2.0.0', date: '06/10/2026', title: 'Champion và Challenger', areas: [
    { name: 'Nghiên cứu chiến lược', changes: ['Thêm Challenger v2.0 chạy song song Champion và bộ đối chiếu kết quả.', 'Ghi nhận đánh giá nghiên cứu, bối cảnh thị trường và kết quả T+ theo từng phiên.'] },
    { name: 'Giao diện & hướng dẫn', changes: ['Bổ sung ba chế độ Champion, Challenger và Đối chiếu trong Bộ lọc tín hiệu.', 'Giải thích quyết định riêng của mỗi bộ máy; phễu và phân kỳ MACD là bằng chứng chung.'] },
  ] },
  { version: '1.0.0', date: 'Trước 06/10/2026', title: 'Bản phát hành nền tảng', areas: [
    { name: 'Sản phẩm', changes: ['Thống nhất tên và nhãn phiên bản Prot Stock v1.0.0 trên ứng dụng và PWA.', 'Giữ các tính năng Core Engine, Prot Flow, sức khỏe thị trường và ngành, phân tích đa khung, watchlist và nhật ký.'] },
    { name: 'Tính tái lập', changes: ['Giữ nguyên mã định danh thuật toán và lịch sử tín hiệu để có thể đối chiếu các phiên đã công bố.'] },
  ] },
] as const

export function VersionHistory({ currentVersion }: { currentVersion: string }) {
  return <div className="version-history"><div className="version-intro panel"><h2>Lịch sử phiên bản</h2><p>Phiên bản đang dùng: <strong>v{currentVersion}</strong>. Mỗi bản ghi nêu phần được thay đổi và tác động người dùng có thể quan sát.</p></div>
    {releases.map(release => <article className="panel version-release" key={release.version}>
      <header><div><span className="version-pill">v{release.version}</span><h3>{release.title}</h3></div><time>{release.date}</time></header>
      <div className="version-areas">{release.areas.map(area => <section key={area.name}><h4>{area.name}</h4><ul>{area.changes.map(change => <li key={change}>{change}</li>)}</ul></section>)}</div>
    </article>)}
  </div>
}
