export type SectorView = 'health' | 'flow'

export type SectorRow = {
  sample_warning?: string | null; health_method_version?: string; health_components?: Record<string,{ value: number | null; valid_count: number; coverage_pct: number }>
  sector: string; sample_size: number; universe_count?: number; coverage_ratio?: number | null
  market_health_score?: number | null; market_health_state?: string
  pct_above_sma50?: number | null; advance_count?: number; decline_count?: number
  flow_observed_count?: number; flow_coverage_ratio?: number | null; flow_median_score?: number | null
  flow_positive_count?: number; flow_negative_count?: number; flow_in_count?: number; flow_out_count?: number
  flow_strong_in_count?: number; flow_strong_out_count?: number; turnover_share_pct?: number | null
}
export type BreadthRow = {
  health_method_version?: string; health_components?: Record<string,{ value: number | null; valid_count: number; coverage_pct: number }>
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
