import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

import { ReplayPanel } from './ReplayPanel'
import { EngineGuide } from './EngineGuide'
export function SettingsPage({ authenticated }: { authenticated: boolean }) {
  const [tab, setTab] = useState<'guide' | 'account'>('guide')
  const rules = useQuery({ queryKey: ['guide-rules'], enabled: authenticated && Boolean(supabase), queryFn: async () => { const { data, error } = await supabase!.from('rules').select('id,name,status,rule_versions(version)').order('name'); if (error) throw error; return data ?? [] } })
  return <section className="workspace-page settings-page">
    <div className="page-title-row"><div><h1>Cài đặt</h1><p className="muted">Hướng dẫn nghiên cứu và thông tin tài khoản riêng của Prot.</p></div></div>
    <div className="timeframe-tabs" role="tablist" aria-label="Cài đặt"><button className={tab === 'guide' ? 'active' : ''} onClick={() => setTab('guide')}>Hướng dẫn</button><button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>Tài khoản</button></div>
    {tab === 'account' ? (
      <article className="panel account-panel">
        <div className="panel-title"><h3>Tài khoản</h3><span>Truy cập riêng tư</span></div>
        <div className="rule-row"><div><strong>Prot</strong></div><span>Đang bảo vệ</span></div>
        <ReplayPanel/>
      </article>
    ) : <Guide rules={rules.data ?? []} loading={rules.isLoading}/>}
  </section>
}

function Guide({ rules, loading }: { rules: any[]; loading: boolean }) {
  const active = rules.filter(rule => rule.status === 'ACTIVE'); const core = active.filter(rule => String(rule.name).startsWith('Prot Core')); const latestVersion = Math.max(0, ...core.flatMap(rule => rule.rule_versions ?? []).map((version: any) => Number(version.version)))
  return <div className="guide-list"><EngineGuide/>
    <details className="guide-group"><summary>Chiến lược phân tích & giao dịch <small>MULTI-TIMEFRAME</small></summary><div className="guide-group-content"><h2>Monthly trend → weekly setup → daily trigger</h2><p>Dùng tháng để xác định đại cục, tuần để chờ vùng giá đẹp và ngày để kích hoạt. Chỉ tìm cơ hội mua khi xu hướng tháng ủng hộ; đặt stop dưới vùng vô hiệu gần nhất.</p><section><h3>1. Monthly Trend</h3><p>Sự kiện tháng dùng EMA10/SMA20 trên tháng đã đóng; các MA khác vẫn có trên chart để tham khảo. Không mua ngược xu hướng tháng.</p></section><section><h3>2. Weekly Setup</h3><p>Chờ pullback về hỗ trợ, supply/demand, Fibonacci hoặc trendline; không mua đuổi.</p></section><section><h3>3. Daily Trigger</h3><p>Chờ nến xác nhận, mẫu hình giá hoặc động lượng RSI/MACD trước khi vào lệnh.</p></section></div></details>
    <details className="guide-group"><summary>Lịch vận hành EOD <small>GIỜ VIỆT NAM</small></summary><div className="guide-group-content"><section><h3>EOD — 16:15, thứ Hai đến thứ Sáu</h3><p>GitHub Actions bắt đầu pipeline sau phiên; hệ thống tải dữ liệu giá, tính D/W/M, mẫu hình, vùng giá và rule. GitHub cron có thể trễ vài phút.</p></section><section><h3>Tín hiệu — sau khi EOD hoàn tất</h3><p>Chỉ gửi Telegram khi có BUY/ADD/REDUCE/EXIT mới. Nếu không có tín hiệu hành động, app không spam.</p></section><section><h3>Nạp dữ liệu lịch sử</h3><p>Chạy tuần tự theo lô 10 mã để tôn trọng rate-limit nguồn miễn phí.</p></section></div></details>
    <details className="guide-group"><summary>Thiết lập quy tắc <small>{loading ? 'ĐANG TẢI' : `${active.length} ACTIVE`}</small></summary><div className="guide-group-content"><h2>Quy tắc là điều kiện, không phải lời khuyên</h2><p>Prot mô tả bằng tiếng Việt; app biên dịch thành DSL được kiểm tra và lưu version.</p><section><h3>Quy tắc nền tảng hiện tại</h3><p><strong>{latestVersion ? `Danh mục engine · phiên bản cấu hình ${latestVersion}` : 'Chưa có Core Rules'}</strong> · {core.length} quy tắc nền tảng đang bật · tổng {active.length} quy tắc đang bật.</p><ul>{core.map(rule => <li key={rule.id}>{rule.name}</li>)}{!core.length && <li>Chưa đọc được quy tắc từ Supabase.</li>}</ul></section><section><h3>Các điều kiện hỗ trợ</h3><p>Breakout, volume, MA stack, RSI, thanh khoản, sức mạnh tương đối, trạng thái VN-Index/ngành, stop-loss, trailing stop và time-stop.</p></section></div></details>
    <details className="guide-group"><summary>Đọc tín hiệu đúng cách <small>KỶ LUẬT</small></summary><div className="guide-group-content"><p>Tín hiệu là giả thuyết có điều kiện. Luôn kiểm tra mẫu hình, vùng vô hiệu, thanh khoản, trạng thái thị trường và rủi ro vị thế trước khi quyết định.</p></div></details>
  </div>
}
