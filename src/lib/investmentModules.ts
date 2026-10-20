import { todayInVietnam } from './date.ts'

export type ReviewStatus = 'PASS' | 'FAIL' | 'UNKNOWN'
export type CheckStatus = ReviewStatus | 'STALE'
export type Review = {
  symbol_id: number; c: ReviewStatus; a: ReviewStatus; n: ReviewStatus; i: ReviewStatus
  reviewed_on: string; reporting_period: string; catalyst: string; risks: string; source_url: string
  revision: number; updated_at?: string
}
export type CycleState = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN' | 'TRANSITION' | 'UNKNOWN'
export type Evidence = {
  quality: string; setup: string; close?: number; pivot?: number; support?: number
  distance_pct?: number; volume_ratio50?: number; range_width_pct?: number; high52_distance_pct?: number
  liquidity_vnd?: number; rs_percentile?: number | null; rs_universe_size?: number
  rs3m?: number | null; rs6m?: number | null; rs12m?: number | null
  rs3m_excess?: number | null; rs6m_excess?: number | null; rs12m_excess?: number | null
  source?: string; price_revision?: string; input_date?: string
  cycle: { state: CycleState; candidate: CycleState; reason?: string; weekly_date?: string
    support?: number; resistance?: number; ma30?: number; slope4_pct?: number; closed_weeks?: number
    evidence_level?: string; daily_event?: string; invalidation?: string }
}
export type ModuleRow = { symbol_id: number; as_of_date: string; version: string; source_revision: string; evidence: Evidence }
export type MarketContext = { trading_date: string; market_health_state: string; coverage_status: string; vnindex_trend_state: string }
export const cycleLabels: Record<CycleState, string> = { ACCUMULATION: 'Nghiêng tích lũy', MARKUP: 'Tăng giá', DISTRIBUTION: 'Nghi phân phối', MARKDOWN: 'Giảm giá', TRANSITION: 'Đang chuyển tiếp', UNKNOWN: 'Chưa xác định' }
export const setupLabels: Record<string, string> = { NEAR_PIVOT: 'Sắp vượt nền', BREAKOUT: 'Vượt nền có volume', BUILDING_BASE: 'Đang xây nền', PULLBACK: 'Điều chỉnh trên MA50', EXTENDED: 'Đã kéo xa', OBSERVE: 'Quan sát', UNKNOWN: 'Chưa đủ dữ liệu' }
export const statusLabels: Record<CheckStatus, string> = { PASS: 'Đạt', FAIL: 'Chưa đạt', UNKNOWN: 'Chưa xác minh', STALE: 'Cần xem lại' }
export const reasonLabels: Record<string, string> = {
  INSUFFICIENT_CLOSED_WEEKS: 'Cần ít nhất 34 tuần đã đóng để đánh giá.',
  ABOVE_RISING_MA30: 'Giá tuần trên MA30 tuần đang tăng, hiệu suất 8 tuần dương.',
  BELOW_FALLING_MA30: 'Giá tuần dưới MA30 tuần đang giảm, hiệu suất 8 tuần âm.',
  BASING_AFTER_DECLINE: 'Vùng giá thu hẹp và MA30 đi ngang sau một nhịp giảm.',
  STALLING_AFTER_ADVANCE: 'Giá chững trong vùng giao dịch sau một nhịp tăng; vẫn có thể là tái tích lũy.',
  AMBIGUOUS_RANGE_OR_TREND: 'Bằng chứng hiện tại chưa phân biệt được nền giá và xu hướng.',
  MISSING_SESSION: 'Chưa có giá hợp lệ cùng ngày công bố EOD.',
  INSUFFICIENT_CANONICAL_HISTORY: 'Chưa đủ lịch sử giá cùng nguồn và phiên bản.',
}
export const eventLabels: Record<string, string> = { SPRING_TEST: 'Spring / kiểm định', SIGN_OF_STRENGTH: 'SOS · sức mạnh', UTAD: 'Phá lên thất bại', SIGN_OF_WEAKNESS: 'SOW · suy yếu' }
export function safeSource(value: string) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null } }
export function reviewIsStale(review: Review, today = todayInVietnam()) {
  return !review.reviewed_on || review.reviewed_on > today || (Date.parse(today) - Date.parse(review.reviewed_on)) / 86_400_000 > 90
}
export function emptyReview(symbolId: number): Review { return { symbol_id: symbolId, c: 'UNKNOWN', a: 'UNKNOWN', n: 'UNKNOWN', i: 'UNKNOWN', reviewed_on: todayInVietnam(), reporting_period: '', catalyst: '', risks: '', source_url: '', revision: 0 } }
export function technicalFresh(row: ModuleRow | undefined, date: string | undefined, revision: string | undefined) {
  return Boolean(row && date && row.as_of_date === date && row.source_revision === revision && row.evidence.quality === 'VALID')
}
export function canslimChecks(row: ModuleRow | undefined, review: Review | undefined, market: MarketContext | null | undefined, date: string | undefined, revision: string | undefined): Record<string, CheckStatus> {
  const manual = (key: 'c' | 'a' | 'n' | 'i'): CheckStatus => review ? reviewIsStale(review) ? 'STALE' : review[key] : 'UNKNOWN'
  const fresh = technicalFresh(row, date, revision)
  const e = row?.evidence
  const marketKnown = fresh && market != null && market.trading_date === date && market.coverage_status === 'COMPLETE'
  return {
    C: manual('c'), A: manual('a'), N: manual('n'),
    S: !fresh || e?.volume_ratio50 == null ? 'UNKNOWN' : e.setup === 'BREAKOUT' ? 'PASS' : 'UNKNOWN',
    L: !fresh || e?.rs_percentile == null ? 'UNKNOWN' : e.rs_percentile >= 80 ? 'PASS' : 'FAIL',
    I: manual('i'),
    M: !marketKnown ? 'UNKNOWN' : market?.market_health_state === 'RISK_ON' && market?.vnindex_trend_state === 'UP' ? 'PASS' : 'FAIL',
  }
}
export function validateReview(review: Review) {
  if (!review.reviewed_on || review.reviewed_on > todayInVietnam()) return 'Chọn ngày xác minh hợp lệ, không ở tương lai.'
  if ((review.c === 'PASS' || review.a === 'PASS') && !review.reporting_period.trim()) return 'Ghi kỳ báo cáo đã đọc để xác nhận C/A.'
  if ([review.c, review.a, review.n, review.i].includes('PASS') && !safeSource(review.source_url)) return 'Thêm liên kết HTTP/HTTPS làm căn cứ cho tiêu chí đạt.'
  if (review.source_url && !safeSource(review.source_url)) return 'Liên kết nguồn không hợp lệ.'
  return null
}
