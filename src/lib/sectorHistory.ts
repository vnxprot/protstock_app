export type SectorView = 'health' | 'flow'
export type SectorPeriod = 'week' | 'month' | 'quarter' | 'year'
export const SECTOR_PERIODS: Record<SectorPeriod, { label: string; sessions: number }> = {
  week: { label: '1 tuần', sessions: 5 },
  month: { label: '1 tháng', sessions: 20 },
  quarter: { label: '1 quý', sessions: 60 },
  year: { label: '1 năm', sessions: 250 },
}

export type SectorRow = {
  sector: string; sample_size: number; universe_count?: number; coverage_ratio?: number | null
  market_health_score?: number | null; market_health_state?: string
  pct_above_sma50?: number | null; advance_count?: number; decline_count?: number
  flow_observed_count?: number; flow_coverage_ratio?: number | null; flow_median_score?: number | null
  flow_positive_count?: number; flow_negative_count?: number; flow_in_count?: number; flow_out_count?: number
  flow_strong_in_count?: number; flow_strong_out_count?: number; turnover_share_pct?: number | null
}
export type BreadthRow = {
  trading_date: string; universe_size: number; observed_count: number; eligible_count: number
  coverage_ratio: number | null; coverage_status: string; market_health_score: number | null
  market_health_state: string; sector_breadth: SectorRow[]
}

export function sectorEligible(day: BreadthRow, row: SectorRow, view: SectorView): boolean {
  const total = row.universe_count ?? row.sample_size
  const coverage = row.coverage_ratio ?? (total ? row.sample_size / total : 0)
  const marketReady = day.coverage_status === 'COMPLETE' || day.coverage_status === 'DEGRADED'
  const sampleReady = row.sample_size >= 5 && coverage >= 0.8
  if (view === 'health') return marketReady && sampleReady && row.market_health_score != null
  // Flow needs its own valid sample; a weak health *score* is not a Flow veto.
  return marketReady && sampleReady && (row.flow_observed_count ?? 0) >= 5
    && (row.flow_coverage_ratio ?? 0) >= 0.8 && row.flow_median_score != null
}

export function sectorValue(row: SectorRow, view: SectorView): number | null {
  const value = view === 'health' ? row.market_health_score : row.flow_median_score
  return value == null ? null : Number(value)
}

function rankAt(day: BreadthRow, sector: string, view: SectorView): number | null {
  const ranked = day.sector_breadth.filter(row => sectorEligible(day, row, view))
    .sort((a, b) => Number(sectorValue(b, view)) - Number(sectorValue(a, view)))
  const rank = ranked.findIndex(row => row.sector === sector)
  return rank < 0 ? null : rank + 1
}

export function sectorHistory(rowsDescending: BreadthRow[], sector: string, view: SectorView, targetSessions: number) {
  const period = rowsDescending.slice(0, targetSessions)
  const observations = period.flatMap(day => {
    const row = day.sector_breadth.find(item => item.sector === sector)
    return row && sectorEligible(day, row, view) ? [{ date: day.trading_date, value: sectorValue(row, view)! }] : []
  }).reverse()
  const latest = observations.at(-1)
  const first = observations[0]
  const sustained = observations.filter(item => view === 'health' ? item.value >= 65 : item.value > 0).length
  const startDay = first && period.find(day => day.trading_date === first.date)
  const endDay = latest && period.find(day => day.trading_date === latest.date)
  const startRank = startDay ? rankAt(startDay, sector, view) : null
  const endRank = endDay ? rankAt(endDay, sector, view) : null
  return {
    observations,
    observedSessions: observations.length,
    availableSessions: period.length,
    complete: period.length >= Math.ceil(targetSessions * 0.8)
      && observations.length >= Math.ceil(period.length * 0.8),
    persistencePct: observations.length ? Math.round(sustained / observations.length * 100) : null,
    scoreChange: first && latest && observations.length > 1 ? Math.round((latest.value - first.value) * 10) / 10 : null,
    rankChange: startRank != null && endRank != null ? startRank - endRank : null,
  }
}

export function relativeSectorTurnover(rowsDescending: BreadthRow[], sector: string): number | null {
  const current = rowsDescending[0]?.sector_breadth.find(row => row.sector === sector)?.turnover_share_pct
  const prior = rowsDescending.slice(1, 21).map(day => day.sector_breadth.find(row => row.sector === sector)?.turnover_share_pct)
    .filter((value): value is number => value != null && Number.isFinite(Number(value)))
  if (current == null || prior.length < 10) return null
  const baseline = prior.reduce((total, value) => total + Number(value), 0) / prior.length
  return baseline > 0 ? Math.round(Number(current) / baseline * 10) / 10 : null
}
