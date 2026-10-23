import './MonthlyTrendEvidence.css'
import { formatMarketPrice } from '../lib/marketUnits'

export type MonthlyEvidence = {
  state?: string; previous_state?: string; policy_version?: string; period_end?: string; source_last_date?: string
  history_months?: number; history_start?: string; state_since?: string; persistence_start?: string; slope_start?: string
  close?: number; previous_close?: number; ema10?: number; previous_ema10?: number; sma20?: number
  above_count?: number; below_count?: number; ema10_slope_3m?: number; monthly_volatility?: number
  entry_threshold?: number; hold_threshold?: number; break_threshold?: number
  entry_up_checks?: Record<string, boolean>; entry_down_checks?: Record<string, boolean>; reasons?: string[]
}
const reasonText: Record<string, string> = {
  MONTHLY_HISTORY_SHORT: 'Chưa đủ 23 tháng đã đóng.', MONTHLY_PRICE_INVALID: 'Chuỗi giá tháng cần được kiểm tra.',
  MONTHLY_UP_ENTRY: 'Đủ các điều kiện xác lập xu hướng tăng.', MONTHLY_DOWN_ENTRY: 'Đủ các điều kiện xác lập xu hướng giảm.',
  MONTHLY_UP_HELD: 'Xu hướng tăng đang được giữ theo ngưỡng duy trì.', MONTHLY_DOWN_HELD: 'Xu hướng giảm đang được giữ theo ngưỡng duy trì.',
  MONTHLY_NEUTRAL: 'Chưa xác lập hướng tăng hoặc giảm đủ mạnh và bền.', MONTHLY_TREND_LOST: 'Xu hướng trước đã mất điều kiện duy trì.',
}
const checks: Record<string, string> = { price_above_ema: 'Close > EMA10', price_below_ema: 'Close < EMA10',
  ema_above_sma: 'EMA10 > SMA20', ema_below_sma: 'EMA10 < SMA20', persistence: 'Độ bền đạt 8/12 tháng', slope: 'Độ dốc đạt ngưỡng vào' }
const price = (n?: number) => formatMarketPrice(n)
const pct = (n?: number) => n == null ? '—' : `${(100 * n).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`
export function MonthlyTrendEvidence({ value }: { value?: MonthlyEvidence }) {
  if (!value?.policy_version) return <p>Chưa có bằng chứng tháng theo quy tắc mới cho phiên này.</p>
  return <section className="monthly-trend-evidence" aria-label="Bằng chứng xu hướng tháng">
    <strong>Tháng {value.state} · kỳ kết thúc {value.period_end ?? '—'}</strong>
    <p>{value.reasons?.map(r => reasonText[r]).filter(Boolean).join(' ')}</p>
    <p>Phiên cuối nến: {value.source_last_date ?? '—'} · trạng thái từ kỳ {value.state_since ?? '—'} · lịch sử {value.history_months ?? 0} tháng. Tháng đang hình thành chưa được sử dụng.</p>
    <dl className="trend-evidence-grid">
      <div><dt>Close tháng / EMA10 / SMA20 (VND)</dt><dd>{price(value.close)} / {price(value.ema10)} / {price(value.sma20)}</dd></div>
      <div><dt>Close / EMA10 tháng trước (VND)</dt><dd>{price(value.previous_close)} / {price(value.previous_ema10)}</dd></div>
      <div><dt>Trên / dưới EMA10 trong 12 tháng</dt><dd>{value.above_count ?? '—'} / {value.below_count ?? '—'} · từ kỳ {value.persistence_start ?? '—'}</dd></div>
      <div><dt>Độ dốc EMA10 quy đổi ba tháng</dt><dd>{pct(value.ema10_slope_3m)} · hồi quy sáu tháng từ kỳ {value.slope_start ?? '—'}</dd></div>
      <div><dt>Ngưỡng vào / giữ / gãy mạnh</dt><dd>{pct(value.entry_threshold)} / {pct(value.hold_threshold)} / {pct(value.break_threshold)}</dd></div>
      <div><dt>Biến động tháng / trạng thái trước</dt><dd>{pct(value.monthly_volatility)} / {value.previous_state ?? '—'}</dd></div>
    </dl>
    <div className="trend-evidence-grid">{(['UP', 'DOWN'] as const).map(direction => <div key={direction}><strong>Điều kiện vào {direction}</strong><ul>{Object.entries((direction === 'UP' ? value.entry_up_checks : value.entry_down_checks) ?? {}).map(([key, pass]) => <li key={key}>{pass ? '✓ Đạt' : '✗ Chưa đạt'} · {checks[key] ?? key}</li>)}</ul></div>)}</div>
    <small>SIDEWAYS cần thêm nền tuần hợp lệ để xét hồi hỗ trợ.</small>
  </section>
}
