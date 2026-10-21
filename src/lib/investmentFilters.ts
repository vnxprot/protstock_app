import { signalHistoryWindow, type SignalHistoryRange } from './signalHistoryRange.ts'
import type { CheckStatus, ModuleRow, Review } from './investmentModules.ts'

export type InvestmentItem = {
  stock: { id: number; symbol: string; sector: string; company_name: string | null; exchange: string; trading_status: string }
  row?: ModuleRow; review?: Review; fresh: boolean; checks: Record<string, CheckStatus>
}
export type InvestmentFilters = {
  query: string; sector: string; exchange: string; tradingStatus: string; watch: string
  setup: string; stage: string; evidence: string; event: string
  checks: Record<string, string>; rsMin: string; rsMax: string; pivotMin: string; pivotMax: string
  liquidityMin: string; liquidityMax: string; dateBasis: string; dateFrom: string; dateTo: string
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
