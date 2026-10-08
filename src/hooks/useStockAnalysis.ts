import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { latestSignalPublication } from '../lib/signalPublication'

export interface PriceBar {
  trading_date: string
  is_complete?: boolean
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TechnicalSnapshot {
  timeframe: 'D' | 'W' | 'M'
  as_of_date: string
  algorithm_version: string
  classical_candidates: ClassicalCandidate[]
  close: number
  sma20: number | null
  sma50: number | null
  sma200: number | null
  ema20: number | null
  rsi14: number | null
  macd: number | null
  macd_signal: number | null
  bollinger_upper: number | null
  bollinger_lower: number | null
  atr14: number | null
  volume_ratio20: number | null
  flow_score: number | null
  flow_state: "PURPLE" | "GREEN" | "RED" | "BLUE" | "NEUTRAL" | "UNKNOWN"
  cmf20: number | null
  obv_slope20: number | null
  flow_volume_ratio20: number | null
  flow_clv: number | null
  trend_state: string
}

export interface PatternInstance {
  id: string
  as_of_date: string
  confirmed_at: string | null
  pattern_type: string
  state: string
  timeframe: string
  start_date: string
  end_date: string
  trigger_price: number | null
  invalidation_price: number | null
  quality_score: number
  direction: string
  reasons: string[]
  evidence: Record<string, number | string | boolean>
}

export interface ClassicalCandidate {
  model: string
  pattern_type: string
  direction: string
  state: string
  quality_score: number
  trigger_price: number | null
  reasons: string[]
}

export interface StockDecision {
  as_of_date: string
  timeframe: 'D' | 'W' | 'M'
  composite_action: 'EXIT' | 'REDUCE' | 'ADD' | 'PROBE_BUY' | 'WATCH'
  reasons: string[]
  source_revision: string
}

export interface PriceZone { id: string; zone_type: 'SUPPORT' | 'RESISTANCE'; lower_price: number; upper_price: number; touches: number; strength: number; as_of_date: string; evidence?: { volume_ratio_at_touches?: number | null; reaction_pct?: number | null; last_touch_date?: string; fibonacci?: { timeframe: string; ratio: number; price: number; sources: string[] }[] } }
export interface FundamentalPeriod {
  id: string
  period_end: string
  published_at: string
  available_from: string
  source: string
  fundamental_metrics: Array<{ revenue: number | null; eps: number | null; roe: number | null; debt_to_equity: number | null; operating_cash_flow: number | null }>
}

export function useSymbols(enabled: boolean) {
  return useQuery({
    queryKey: ['symbols'], enabled: enabled && Boolean(supabase), staleTime: 300_000,
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured')
      const { data, error } = await supabase.from('symbols').select('id,symbol,company_name,sector,exchange,trading_status').eq('active', true).order('symbol')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useStockAnalysis(symbol: string | null, timeframe: 'D' | 'W' | 'M', enabled: boolean) {
  const publication = useQuery({ queryKey: ['signal-publication'], enabled: enabled && Boolean(supabase), staleTime: 60_000, queryFn: latestSignalPublication })
  return useQuery({
    queryKey: ['stock-analysis', symbol, timeframe, publication.data?.date, publication.data?.sourceRevision], enabled: enabled && Boolean(supabase) && Boolean(symbol) && !publication.isPending, staleTime: 300_000,
    queryFn: async () => {
      if (!supabase || !symbol) throw new Error('Symbol is required')
      if (publication.error) throw publication.error
      const { data, error } = await supabase.rpc('stock_analysis_data', { p_symbol: symbol, p_timeframe: timeframe, p_as_of_date: publication.data?.date ?? null, p_revision: publication.data?.sourceRevision ?? null, p_history_limit: timeframe === 'D' ? 2600 : 500 })
      if (error) throw error
      const technical = (data.technical ?? []) as TechnicalSnapshot[]
      const decision = data.decision as StockDecision | null
      return {
        symbol: data.symbol as { id: number; symbol: string; sector: string; exchange: string; company_name: string | null },
        prices: (data.prices ?? []) as PriceBar[], technical,
        decision: decision?.source_revision === technical[0]?.algorithm_version ? decision : null,
        patterns: (data.patterns ?? []) as PatternInstance[],
        zones: latestUniqueZones((data.zones ?? []) as PriceZone[], technical[0]?.as_of_date),
        disclosures: (data.disclosures ?? []) as Array<{ id: string; title: string; category: string; published_at: string; available_from: string; source: string; source_url: string | null }>,
        fundamentals: (data.fundamentals ?? []) as FundamentalPeriod[],
        publication: publication.data ?? null,
      }
    },
  })
}

function latestUniqueZones(rows: PriceZone[], latestDate?: string): PriceZone[] {
  const seen = new Set<string>()
  return rows.filter(zone => {
    if (zone.as_of_date !== latestDate) return false
    const key = `${zone.zone_type}:${Number(zone.lower_price).toFixed(3)}:${Number(zone.upper_price).toFixed(3)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 6)
}
