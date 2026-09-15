import type { PriceZone } from '../hooks/useStockAnalysis'
import { formatDate } from '../lib/date'
import { formatMarketPrice } from '../lib/marketUnits'
import '../zone-quality.css'

export function ZoneEvidence({ zone }: { zone: PriceZone }) {
  const evidence = zone.evidence
  if (!evidence) return null
  const fibers = evidence.fibonacci ?? []
  return (
    <div className="zone-evidence">
      {evidence.volume_ratio_at_touches != null && <span title="Volume tại các pivot / trung bình 20 nến trước từng pivot">Volume <b>{evidence.volume_ratio_at_touches.toFixed(2)}×</b></span>}
      {evidence.reaction_pct != null && <span title="Vị trí đóng cửa rời cực trị của nến tại vùng; không phải xác suất thắng">Phản ứng <b>{evidence.reaction_pct.toFixed(0)}%</b></span>}
      {evidence.last_touch_date && <span>Chạm gần nhất <b>{formatDate(evidence.last_touch_date)}</b></span>}
      {fibers.length > 0 && <details className="zone-fib-details"><summary>Fib hợp lưu · +4</summary><ul>{fibers.map((fib, i) => <li key={`${fib.timeframe}-${fib.ratio}-${i}`}>{fib.timeframe === 'W' ? 'Tuần' : 'Tháng'} · {(fib.ratio * 100).toLocaleString('vi-VN')}% · {formatMarketPrice(fib.price)}<small>{fib.sources.map(source => ({ SUPPORT: 'Hỗ trợ', W_EMA20: 'EMA20 tuần', W_SMA50: 'SMA50 tuần', PULLBACK_SETUP: 'Setup pullback' }[source] ?? source)).join(' · ')}</small></li>)}</ul></details>}
    </div>
  )
}
