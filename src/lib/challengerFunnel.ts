import type { MonthlyEvidence } from '../components/MonthlyTrendEvidence'

export type FunnelRow = {
  symbol_id: number; symbol: string; action: string; reasons: string[]
  base_price: number | null; invalidation_price: number | null
  evidence: {
    funnel_stage?: string; monthly_state?: string; weekly_setup?: string | null
    setup_date?: string | null; trigger_date?: string | null; trigger_age_sessions?: number | null
    weekly?: { date?: string }; market_regime?: string; distance_to_stop_pct?: number | null
    size_multiplier?: number; monthly?: MonthlyEvidence; funnel_reasons?: string[]
    setup_id?: string | null
  }
}
export const funnelGroups = {
  ACTIVE: 'Đang theo dõi', DAILY_TRIGGER: 'Kích hoạt mới trong phiên', WEEKLY_READY: 'Đang chờ kích hoạt',
  TRIGGERED_EARLIER: 'Đã kích hoạt · còn hiệu lực', MONTHLY_CONTEXT: 'Chưa có setup hợp lệ',
  DATA_QUARANTINED: 'Dữ liệu cần kiểm tra', ALL: 'Tất cả',
}
export type FunnelGroup = keyof typeof funnelGroups
export const setupNames: Record<string, string> = {
  WEEKLY_BREAKOUT_13: 'Vượt đỉnh 13 tuần', WEEKLY_PULLBACK_EMA20: 'Hồi về EMA20', WEEKLY_RANGE_SUPPORT: 'Hồi từ hỗ trợ',
}
export function inFunnelGroup(row: FunnelRow, group: FunnelGroup): boolean {
  const stage = row.evidence.funnel_stage
  return group === 'ALL' || (group === 'ACTIVE'
    ? ['DAILY_TRIGGER', 'WEEKLY_READY', 'TRIGGERED_EARLIER'].includes(stage ?? '') : stage === group)
}
export function setupDate(row: FunnelRow): string | null {
  return row.evidence.setup_date ?? row.evidence.weekly?.date ?? null
}
export function sortFunnelRows(a: FunnelRow, b: FunnelRow): number {
  const order = ['DAILY_TRIGGER', 'WEEKLY_READY', 'TRIGGERED_EARLIER', 'MONTHLY_CONTEXT', 'DATA_QUARANTINED']
  const rank = (row: FunnelRow) => { const i = order.indexOf(row.evidence.funnel_stage ?? ''); return i < 0 ? 5 : i }
  const event = (row: FunnelRow) => row.evidence.trigger_date ?? setupDate(row) ?? ''
  return rank(a) - rank(b) || event(b).localeCompare(event(a)) || a.symbol.localeCompare(b.symbol)
}
const reasons: Record<string, string> = {
  REGIME_BLOCKED: 'Bối cảnh thị trường chưa cho phép', CHASE_BLOCKED: 'Giá ngoài khoảng cách stop cho phép',
  CHAMPION_EXIT_CONFLICT: 'Champion đang yêu cầu giảm/thoát', INSUFFICIENT_LIQUIDITY: 'Thanh khoản chưa đạt',
  HIGH_PARTICIPATION_RISK: 'Lệnh dự kiến vượt giới hạn thanh khoản',
}
export function funnelResult(row: FunnelRow): string {
  const blocked = row.reasons.find(reason => reasons[reason])
  if (blocked) return reasons[blocked]
  if (row.action !== 'WATCH') return 'Đã qua các cổng hành động'
  switch (row.evidence.funnel_stage) {
    case 'DAILY_TRIGGER': return 'Đã kích hoạt · chưa qua cổng hành động'
    case 'WEEKLY_READY': return 'Chờ giá ngày xác nhận'
    case 'TRIGGERED_EARLIER': return 'Theo dõi setup đã kích hoạt'
    case 'DATA_QUARANTINED': return 'Cần kiểm tra dữ liệu giá'
    default: return row.evidence.monthly_state === 'DOWN' ? 'Tháng DOWN · chưa mở cổng' : 'Chưa có setup tuần hợp lệ'
  }
}
