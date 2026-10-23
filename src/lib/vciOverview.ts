export type VciOverview = {
  source?: 'VCI_DIRECT'; status?: string; fetched_at?: string
  market_cap?: number | null; shares?: number | null
  free_float_pct?: number | null; free_float_shares?: number | null
  pe?: number | null; pb?: number | null; eps?: number | null
  roe?: number | null; roa?: number | null
  ratio_period?: string | null; ratio_basis?: string
  eps_period?: string | null; eps_basis?: string
}
export const vciNumber = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: digits })
export const vciValue = (value: number | null | undefined, unit: string, divisor = 1) =>
  value == null || !Number.isFinite(value) ? '—' : `${vciNumber(value / divisor)}${unit}`
