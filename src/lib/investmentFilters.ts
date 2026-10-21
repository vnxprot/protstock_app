import { signalHistoryWindow, type SignalHistoryRange } from './signalHistoryRange.ts'
import { cycleLabels, eventLabels, setupLabels, statusLabels, type CheckStatus, type ModuleRow, type Review } from './investmentModules.ts'

export type InvestmentItem = {
  stock: { id: number; symbol: string; sector: string; company_name: string | null; exchange: string; trading_status: string }
  row?: ModuleRow; review?: Review; fresh: boolean; checks: Record<string, CheckStatus>
}
export type InvestmentFilters = {
  query: string; sector: string; exchange: string; tradingStatus: string; watch: string
  setup: string; stage: string; evidence: string; event: string
  checks: Record<string, string>; rsMin: string; rsMax: string; pivotMin: string; pivotMax: string
  liquidityMin: string; liquidityMax: string; dateBasis: string; dateFrom: string; dateTo: string
  columns?: Partial<Record<InvestmentColumn, string[]>>
}
export type InvestmentColumn = 'symbol' | 'checks' | 'setup' | 'rs' | 'pivot' | 'stage' | 'evidence' | 'event' | 'weekly' | 'liquidity' | 'watch'
export type ColumnChoice = { key: string; label: string; value: string | number | null }
const decimal = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
export function investmentColumnValue(item: InvestmentItem, column: InvestmentColumn, watched: string[]): ColumnChoice {
  const e = item.fresh ? item.row?.evidence : undefined
  let value: string | number | null = null, label = '—'
  if (column === 'symbol') return { key: item.stock.symbol, label: `${item.stock.symbol} · ${item.stock.sector}`, value: item.stock.symbol }
  if (column === 'checks') {
    const letters = ['C', 'A', 'N', 'S', 'L', 'I', 'M']
    return { key: letters.map(letter => `${letter}:${item.checks[letter] ?? 'UNKNOWN'}`).join('|'), label: letters.map(letter => `${letter}: ${statusLabels[item.checks[letter] ?? 'UNKNOWN']}`).join(' · '), value: letters.map(letter => item.checks[letter] ?? 'UNKNOWN').join('|') }
  }
  if (column === 'setup') { value = e?.setup ?? 'UNKNOWN'; label = setupLabels[value] ?? 'Quan sát' }
  if (column === 'stage') { value = e?.cycle.state ?? 'UNKNOWN'; label = cycleLabels[value as keyof typeof cycleLabels] }
  if (column === 'evidence') {
    value = e?.cycle.state === 'TRANSITION' ? `Nghiêng ${cycleLabels[e.cycle.candidate].toLowerCase()}` : e?.cycle.evidence_level === 'SUPPORTED' ? 'Hai tuần đồng thuận' : 'Chưa đủ bằng chứng'
    label = value
  }
  if (column === 'event') { value = e?.cycle.daily_event ?? null; label = value ? eventLabels[value] ?? value : '—' }
  if (column === 'weekly') { value = e?.cycle.weekly_date ?? null; label = value ? value.split('-').reverse().join('/') : '—' }
  if (column === 'watch') { value = watched.includes(item.stock.symbol) ? 'WATCHED' : 'UNWATCHED'; label = value === 'WATCHED' ? 'Đang theo dõi' : 'Chưa theo dõi' }
  if (column === 'rs' || column === 'pivot' || column === 'liquidity') {
    const number = column === 'rs' ? e?.rs_percentile : column === 'pivot' ? e?.distance_pct : e?.liquidity_vnd == null ? null : e.liquidity_vnd / 1e9
    value = number == null ? null : Math.round(number * 10) / 10
    label = value == null ? '—' : `${decimal(value)}${column === 'pivot' ? '%' : column === 'liquidity' ? ' tỷ' : ''}`
  }
  return { key: value == null ? '__EMPTY__' : String(value), label, value }
}
export function compareInvestmentColumn(a: ColumnChoice, b: ColumnChoice, direction: 'asc' | 'desc') {
  if (a.value == null || b.value == null) return a.value == null ? b.value == null ? 0 : 1 : -1
  const dates = typeof a.value === 'string' && typeof b.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.value) && /^\d{4}-\d{2}-\d{2}$/.test(b.value)
  const result = typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : dates ? String(a.value).localeCompare(String(b.value)) : a.label.localeCompare(b.label, 'vi', { numeric: true, sensitivity: 'base' })
  return direction === 'asc' ? result : -result
}
export function emptyInvestmentFilters(): InvestmentFilters {
  return { query: '', sector: 'ALL', exchange: 'ALL', tradingStatus: 'ALL', watch: 'ALL', setup: 'ALL', stage: 'ALL', evidence: 'ALL', event: 'ALL', checks: {}, rsMin: '', rsMax: '', pivotMin: '', pivotMax: '', liquidityMin: '', liquidityMax: '', dateBasis: 'as_of_date', dateFrom: '', dateTo: '' }
}
export function investmentDate(item: InvestmentItem, basis: string) {
  if (basis === 'reviewed_on') return item.review?.reviewed_on
  if (basis === 'weekly_date') return item.fresh ? item.row?.evidence.cycle.weekly_date : undefined
  return item.row?.as_of_date
}
export function investmentRange(range: SignalHistoryRange, latest: string | null) {
  if (range === '1D') return { dateFrom: latest ?? '', dateTo: latest ?? '' }
  const window = signalHistoryWindow(range, latest)
  return window ? { dateFrom: window.dateFrom, dateTo: window.dateTo } : null
}
const within = (value: number | null | undefined, min: string, max: string) => {
  if (!min && !max) return true
  return value != null && Number.isFinite(value) && (!min || value >= Number(min)) && (!max || value <= Number(max))
}
export function invalidInvestmentRange(filters: InvestmentFilters) {
  return Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
    || [['rsMin', 'rsMax'], ['pivotMin', 'pivotMax'], ['liquidityMin', 'liquidityMax']].some(([min, max]) => {
      const lower = filters[min as keyof InvestmentFilters], upper = filters[max as keyof InvestmentFilters]
      return typeof lower === 'string' && typeof upper === 'string' && lower !== '' && upper !== '' && Number(lower) > Number(upper)
    })
}
export function matchesInvestmentFilters(item: InvestmentItem, f: InvestmentFilters, watched: string[]) {
  if (invalidInvestmentRange(f)) return false
  const { stock, row, fresh, checks } = item, e = fresh ? row?.evidence : undefined
  if (Object.entries(f.columns ?? {}).some(([column, selected]) => selected && !selected.includes(investmentColumnValue(item, column as InvestmentColumn, watched).key))) return false
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd')
  if (f.query && !normalize(`${stock.symbol} ${stock.company_name ?? ''}`).includes(normalize(f.query.trim()))) return false
  if (f.sector !== 'ALL' && f.sector !== stock.sector || f.exchange !== 'ALL' && f.exchange !== stock.exchange || f.tradingStatus !== 'ALL' && f.tradingStatus !== stock.trading_status) return false
  if (f.watch === 'WATCHED' && !watched.includes(stock.symbol) || f.watch === 'UNWATCHED' && watched.includes(stock.symbol)) return false
  if (f.setup !== 'ALL' && (e?.setup ?? 'UNKNOWN') !== f.setup || f.stage !== 'ALL' && (e?.cycle.state ?? 'UNKNOWN') !== f.stage) return false
  if (f.evidence !== 'ALL' && (e?.cycle.evidence_level ?? 'INSUFFICIENT') !== f.evidence) return false
  if (f.event !== 'ALL' && (e?.cycle.daily_event ?? 'NONE') !== f.event) return false
  if (Object.entries(f.checks).some(([letter, status]) => status !== 'ALL' && checks[letter] !== status)) return false
  if (!within(e?.rs_percentile, f.rsMin, f.rsMax) || !within(e?.distance_pct, f.pivotMin, f.pivotMax) || !within(e?.liquidity_vnd == null ? null : e.liquidity_vnd / 1e9, f.liquidityMin, f.liquidityMax)) return false
  const day = investmentDate(item, f.dateBasis)
  if ((f.dateFrom || f.dateTo) && (!day || f.dateFrom && day < f.dateFrom || f.dateTo && day > f.dateTo)) return false
  return true
}
