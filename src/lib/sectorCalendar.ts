import { sectorEligible, sectorValue, type BreadthRow, type SectorRow, type SectorView } from './sectorHistory.ts'

export type SectorGrain = 'day' | 'week' | 'month' | 'quarter' | 'year'
export const SECTOR_GRAINS: { key: SectorGrain; label: string }[] = [
  { key: 'day', label: 'Ngày' }, { key: 'week', label: 'Tuần' },
  { key: 'month', label: 'Tháng' }, { key: 'quarter', label: 'Quý' }, { key: 'year', label: 'Năm' },
]

const utcDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`)
const isoDate = (value: Date) => value.toISOString().slice(0, 10)

export function calendarKey(date: string, grain: SectorGrain): string {
  if (grain === 'day') return date.slice(0, 10)
  if (grain === 'year') return date.slice(0, 4)
  if (grain === 'month') return date.slice(0, 7)
  if (grain === 'quarter') return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
  const monday = utcDate(date)
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  return isoDate(monday)
}

export function calendarBounds(key: string, grain: SectorGrain): { start: string; end: string } {
  if (grain === 'day') return { start: key, end: key }
  if (grain === 'week') {
    const sunday = utcDate(key)
    sunday.setUTCDate(sunday.getUTCDate() + 6)
    return { start: key, end: isoDate(sunday) }
  }
  const year = Number(key.slice(0, 4))
  if (grain === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` }
  const month = grain === 'quarter' ? (Number(key.slice(-1)) - 1) * 3 + 1 : Number(key.slice(5, 7))
  const length = grain === 'quarter' ? 3 : 1
  return { start: `${year}-${String(month).padStart(2, '0')}-01`, end: isoDate(new Date(Date.UTC(year, month - 1 + length, 0))) }
}

export function calendarLabel(key: string, grain: SectorGrain): string {
  if (grain === 'day') return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`
  if (grain === 'week') {
    const end = calendarBounds(key, grain).end
    return `${key.slice(8, 10)}/${key.slice(5, 7)}–${end.slice(8, 10)}/${end.slice(5, 7)}`
  }
  if (grain === 'month') return `Tháng ${Number(key.slice(5, 7))}/${key.slice(0, 4)}`
  if (grain === 'quarter') return `Quý ${['I', 'II', 'III', 'IV'][Number(key.slice(-1)) - 1]}/${key.slice(0, 4)}`
  return `Năm ${key}`
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

export function sectorPeriodSummary(rows: BreadthRow[], marketDates: string[], sector: string, view: SectorView) {
  const marketSet = new Set(marketDates)
  const stored = rows.filter(day => marketSet.has(day.trading_date))
  const valid = stored.flatMap(day => {
    const item = day.sector_breadth.find(row => row.sector === sector)
    return item && sectorEligible(day, item, view) ? [{ date: day.trading_date, value: sectorValue(item, view)!, item }] : []
  }).sort((a, b) => a.date.localeCompare(b.date))
  const values = valid.map(item => item.value)
  const latest = valid.at(-1)
  const first = valid[0]
  const expected = marketDates.length
  const recorded = stored.length
  const qualified = valid.length
  const reason = expected === 0 ? 'Chưa có phiên giao dịch' : recorded < Math.ceil(expected * 0.8)
    ? 'Thiếu dữ liệu thị trường' : qualified < Math.ceil(expected * 0.8)
      ? view === 'health' ? 'Ngành thiếu mẫu hợp lệ' : 'Ngành thiếu mẫu Flow' : null
  const positive = valid.filter(item => view === 'health' ? item.value >= 65 : item.value > 0).length
  const shares = valid.map(item => item.item.turnover_share_pct).filter((value): value is number => value != null)
  return {
    score: median(values), lastValue: latest?.value ?? null,
    change: first && latest && qualified > 1 ? latest.value - first.value : null,
    persistencePct: qualified ? Math.round(positive / qualified * 100) : null,
    turnoverSharePct: median(shares), expected, recorded, qualified,
    complete: reason === null, reason, lastDate: latest?.date ?? null,
    lastRow: latest?.item ?? null as SectorRow | null,
  }
}
