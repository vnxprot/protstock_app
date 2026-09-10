import { useState } from 'react'

export function SettingsPage() {
  const [tab, setTab] = useState<'guide' | 'account'>('guide')
  return <section className="workspace-page settings-page">
    <div className="page-title-row"><div><span className="eyebrow">PERSONAL WORKSPACE</span><h1>Cài đặt</h1><p className="muted">Hướng dẫn nghiên cứu và thông tin tài khoản riêng của Prot.</p></div></div>
    <div className="timeframe-tabs" role="tablist" aria-label="Cài đặt">
      <button className={tab === 'guide' ? 'active' : ''} onClick={() => setTab('guide')}>Hướng dẫn</button>
      <button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>Tài khoản</button>
    </div>
    {tab === 'account' ? <article className="panel account-panel"><div className="panel-title"><h3>Tài khoản</h3><span>Private access</span></div><div className="rule-row"><div><strong>Prot</strong><small>Tài khoản cá nhân · đăng nhập bằng mật khẩu</small></div><span>Đang bảo vệ</span></div><p className="muted">Mật khẩu không hiển thị hoặc lưu trong giao diện. Dùng nút Đăng xuất ở sidebar khi cần kết thúc phiên.</p></article> : <Guide />}
  </section>
}

function Guide() {
  return <article className="panel guide-panel">
    <div className="panel-title"><h3>Chiến lược phân tích & giao dịch</h3><span>Multi-timeframe</span></div>
    <h2>Monthly trend → weekly setup → daily trigger</h2>
    <p>Đây là chiến lược phân tích và giao dịch theo đa khung thời gian rất nổi tiếng trong trading. Chiến lược giúp bám theo xu hướng lớn nhưng vẫn tối ưu điểm vào lệnh để giảm rủi ro.</p>
    <section><h3>📈 Monthly Trend — Xác định “Đại cục”</h3><p>Dùng biểu đồ nến tháng để xác định hướng đi chính: chỉ tìm cơ hội mua khi xu hướng tháng tăng và chỉ bán/giảm tỷ trọng khi xu hướng tháng giảm.</p><ul><li><strong>Cách xác định:</strong> cấu trúc đỉnh/đáy hoặc EMA 20, SMA 50.</li><li><strong>Mục tiêu:</strong> giao dịch cùng hướng dòng tiền lớn, không đi ngược xu hướng.</li></ul></section>
    <section><h3>🗒 Weekly Setup — Chờ vùng giá đẹp</h3><p>Sau khi có hướng tháng, dùng khung tuần để chờ một setup: giá điều chỉnh về hỗ trợ/kháng cự, supply/demand, Fibonacci hoặc trendline.</p><ul><li><strong>Xu hướng tháng tăng:</strong> đợi pullback về hỗ trợ mạnh trên tuần.</li><li><strong>Ý nghĩa:</strong> tránh mua đuổi; mua giá tốt hơn trong xu hướng dài hạn.</li></ul></section>
    <section><h3>🔎 Daily Trigger — Kích hoạt vào lệnh</h3><p>Khi giá vào vùng setup tuần, dùng khung ngày tìm xác nhận: Pin Bar, Engulfing, Morning Star, hai đáy, vai-đầu-vai ngược, RSI quá bán hoặc MACD cắt lên.</p><ul><li><strong>Vào lệnh:</strong> khi xuất hiện xác nhận dòng tiền quay lại.</li><li><strong>Quản trị rủi ro:</strong> đặt stop-loss dưới đáy nến ngày hoặc hỗ trợ gần nhất.</li><li><strong>Ý nghĩa:</strong> tối ưu R:R — rủi ro nhỏ, lợi nhuận bám theo xu hướng tháng.</li></ul></section>
  </article>
}
