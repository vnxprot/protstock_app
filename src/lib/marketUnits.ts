// Vnstock OHLC values are stored in thousand VND. Keep storage untouched and
// convert only at the UI boundary, where portfolio transactions use VND/share.
export const MARKET_PRICE_TO_VND = 1_000

export function formatVnd(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits })} ₫`
}

export function formatMarketPrice(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return formatVnd(Number(value) * MARKET_PRICE_TO_VND, digits)
}
