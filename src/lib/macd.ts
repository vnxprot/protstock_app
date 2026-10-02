import type { PriceBar } from '../hooks/useStockAnalysis'

export type MacdPoint = { time: string; macd: number; signal: number | null; histogram: number | null; cross: 'UP' | 'DOWN' | null }

function ema(values: number[], length: number): (number | null)[] {
  const result: (number | null)[] = Array(values.length).fill(null)
  if (values.length < length) return result
  let current = values.slice(0, length).reduce((sum, value) => sum + value, 0) / length
  result[length - 1] = current
  for (let i = length; i < values.length; i++) {
    current = (values[i] - current) * 2 / (length + 1) + current
    result[i] = current
  }
  return result
}

export function calculateMacd(bars: PriceBar[]): MacdPoint[] {
  const closed = bars.filter(bar => bar.is_complete !== false).slice().sort((a, b) => a.trading_date.localeCompare(b.trading_date))
  const closes = closed.map(bar => Number(bar.close))
  const fast = ema(closes, 12), slow = ema(closes, 26)
  const macd = closes.flatMap((_, i) => fast[i] == null || slow[i] == null ? [] : [fast[i]! - slow[i]!])
  const signal = ema(macd, 9)
  return closed.flatMap((bar, i) => {
    if (i < 25) return []
    const index = i - 25, value = macd[index], line = signal[index]
    const histogram = line == null ? null : value - line
    const previous = index > 0 && signal[index - 1] != null ? macd[index - 1] - signal[index - 1]! : null
    const cross = histogram == null || previous == null ? null : previous <= 0 && histogram > 0 ? 'UP' : previous >= 0 && histogram < 0 ? 'DOWN' : null
    return [{ time: bar.trading_date, macd: value, signal: line, histogram, cross }]
  })
}
