import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

import { ReplayPanel } from './ReplayPanel'
import { EngineGuide } from './EngineGuide'
export function SettingsPage({ authenticated, isAdmin = true }: { authenticated: boolean; isAdmin?: boolean }) {
  const [tab, setTab] = useState<'intro' | 'guide' | 'account'>(isAdmin ? 'guide' : 'intro')
  const rules = useQuery({ queryKey: ['guide-rules'], enabled: authenticated && Boolean(supabase), queryFn: async () => { const { data, error } = await supabase!.from('rules').select('id,name,status,rule_versions(version)').order('name'); if (error) throw error; return data ?? [] } })
  return <section className="workspace-page settings-page">
    <div className="page-title-row"><div><h1>Cài đặt</h1><p className="muted">Hướng dẫn nghiên cứu và thông tin tài khoản riêng của Prot.</p></div></div>
    <div className="timeframe-tabs" role="tablist" aria-label="Cài đặt">{!isAdmin&&<button className={tab === 'intro' ? 'active' : ''} onClick={() => setTab('intro')}>Giới thiệu</button>}<button className={tab === 'guide' ? 'active' : ''} onClick={() => setTab('guide')}>Hướng dẫn</button>{isAdmin&&<button className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>Tài khoản</button>}</div>
    {tab === 'intro' ? <Intro/> : tab === 'account' ? (
      <article className="panel account-panel">
        <div className="panel-title"><h3>Tài khoản</h3><span>Truy cập riêng tư</span></div>
        <div className="rule-row"><div><strong>Prot</strong></div><span>Đang bảo vệ</span></div>
        <ReplayPanel/>
      </article>
    ) : <Guide rules={rules.data ?? []} loading={rules.isLoading} includeIntro={isAdmin}/>}
  </section>
}

function Intro(){ return <article className="panel app-intro-card"><h2>Giới thiệu Prot Stock</h2><p>Prot Stock là công cụ theo dõi thị trường, phân tích đa khung và tổng hợp tín hiệu cho cổ phiếu Việt Nam.</p><div><strong>Dữ liệu cập nhật sau 17:00</strong><span>từ thứ Hai đến thứ Sáu.</span></div></article> }
function Guide({ rules, loading, includeIntro }: { rules: any[]; loading: boolean; includeIntro: boolean }) {
  const active = rules.filter(rule => rule.status === 'ACTIVE'); const core = active.filter(rule => String(rule.name).startsWith('Prot Core')); const latestVersion = Math.max(0, ...core.flatMap(rule => rule.rule_versions ?? []).map((version: any) => Number(version.version)))
  return <div className="guide-list">{includeIntro&&<Intro/>}<EngineGuide/>
    <details className="guide-group"><summary>Chiến lược phân tích & giao dịch <small>MULTI-TIMEFRAME</small></summary><div className="guide-group-content"><h2>Monthly trend → weekly setup → daily trigger</h2><p>Dùng tháng để xác định đại cục, tuần để chờ vùng giá đẹp và ngày để kích hoạt. Chỉ tìm cơ hội mua khi xu hướng tháng ủng hộ; đặt stop dưới vùng vô hiệu gần nhất.</p><section><h3>1. Monthly Trend</h3><p>Sự kiện tháng dùng EMA10/SMA20 trên tháng đã đóng; các MA khác vẫn có trên chart để tham khảo. Không mua ngược xu hướng tháng.</p></section><section><h3>2. Weekly Setup</h3><p>Chờ pullback về hỗ trợ, supply/demand, Fibonacci hoặc trendline; không mua đuổi.</p></section><section><h3>3. Daily Trigger</h3><p>Chờ nến xác nhận, mẫu hình giá hoặc động lượng RSI/MACD trước khi vào lệnh.</p></section></div></details>
    <details className="guide-group"><summary>Thiết lập quy tắc <small>{loading ? 'ĐANG TẢI' : `${active.length} ACTIVE`}</small></summary><div className="guide-group-content"><h2>Quy tắc là điều kiện, không phải lời khuyên</h2><p>Prot mô tả bằng tiếng Việt; app biên dịch thành DSL được kiểm tra và lưu version.</p><section><h3>Quy tắc nền tảng hiện tại</h3><p><strong>{latestVersion ? `Danh mục engine · phiên bản cấu hình ${latestVersion}` : 'Chưa có Core Rules'}</strong> · {core.length} quy tắc nền tảng đang bật · tổng {active.length} quy tắc đang bật.</p><ul>{core.map(rule => <li key={rule.id}>{rule.name}</li>)}{!core.length && <li>Chưa đọc được quy tắc từ Supabase.</li>}</ul></section><section><h3>Các điều kiện hỗ trợ</h3><p>Breakout, volume, MA stack, RSI, thanh khoản, sức mạnh tương đối, trạng thái VN-Index/ngành, stop-loss, trailing stop và time-stop.</p></section></div></details>
    <details className="guide-group"><summary>Đọc tín hiệu đúng cách <small>KỶ LUẬT</small></summary><div className="guide-group-content"><p>Tín hiệu là giả thuyết có điều kiện. Luôn kiểm tra mẫu hình, vùng vô hiệu, thanh khoản, trạng thái thị trường và rủi ro vị thế trước khi quyết định.</p></div></details>
    <details className="guide-group"><summary>Lịch vận hành EOD <small>GIỜ VIỆT NAM</small></summary><div className="guide-group-content"><div className="eod-stepper"><section><i>1</i><div><h3>GitHub Fast Lane · 16:15</h3><p>Thứ Hai–Thứ Sáu, Fast Lane tải giá, tính D/W/M, mẫu hình, vùng giá và các Core Engine. Nếu đủ 202/202 mã, hệ thống hoàn tất tín hiệu và Telegram.</p></div></section><section><i>2</i><div><h3>Supabase Cron · 16:20</h3><p>Watchdog kiểm tra EOD hôm nay. Nếu chưa có hoặc lỗi, nó tự dispatch Fast Lane; nếu đã đủ thì không chạy trùng.</p></div></section><section><i>3</i><div><h3>Supabase Cron · 16:50</h3><p>Kiểm tra lần cuối. Chỉ retry các mã còn thiếu, đổi KBS ↔ VCI khi cần. Nếu vẫn thiếu, Telegram vẫn gửi tín hiệu hợp lệ cùng nhãn dữ liệu tạm thời.</p></div></section><section><i>4</i><div><h3>Tín hiệu &amp; lịch sử</h3><p>Telegram chỉ nhận PROBE_BUY/ADD/REDUCE/EXIT mới. Nạp lịch sử chạy theo lô để tôn trọng rate-limit nguồn miễn phí.</p></div></section></div></div></details>
  </div>
}
