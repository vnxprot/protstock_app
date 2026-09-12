import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface PriceBar {
  trading_date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TechnicalSnapshot {
  timeframe: 'D' | 'W' | 'M'
  as_of_date: string
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
  trend_state: string
}

export interface PatternInstance {
  id: string
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

export interface PriceZone { id: string; zone_type: 'SUPPORT' | 'RESISTANCE'; lower_price: number; upper_price: number; touches: number; strength: number; as_of_date: string }
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
      const { data, error } = await supabase.from('symbols').select('id,symbol,sector,exchange').eq('active', true).order('symbol')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useStockAnalysis(symbol: string | null, timeframe: 'D' | 'W' | 'M', enabled: boolean) {
  return useQuery({
    queryKey: ['stock-analysis', symbol, timeframe], enabled: enabled && Boolean(supabase) && Boolean(symbol), staleTime: 60_000,
    queryFn: async () => {
      if (!supabase || !symbol) throw new Error('Symbol is required')
      const { data: symbolRow, error: symbolError } = await supabase.from('symbols').select('id,symbol,sector,exchange,company_name').eq('symbol', symbol).single()
      if (symbolError) throw symbolError
      // Supabase giới hạn mỗi REST response ở 1.000 dòng. Ghép ba trang để chart D
      // chứa tới 2.600 phiên (~10 năm), đủ hiển thị toàn bộ lịch sử từ 01/01/2021.
      const dailyPriceQuery = async () => {
        const base = () => supabase!.from('daily_prices').select('trading_date,open,high,low,close,volume').eq('symbol_id', symbolRow.id).order('trading_date', { ascending: false })
        const pages = await Promise.all([base().range(0, 999), base().range(1000, 1999), base().range(2000, 2599)])
        const failed = pages.find(page => page.error)
        return { data: pages.flatMap(page => page.data ?? []), error: failed?.error ?? null }
      }
      const priceQuery = timeframe === 'D'
        ? dailyPriceQuery()
        : supabase.from('derived_bars').select('trading_date:source_last_date,open,high,low,close,volume').eq('symbol_id', symbolRow.id).eq('timeframe', timeframe).order('period_start', { ascending: false }).limit(260)
      const [prices, technical, patterns, zones, disclosures, fundamentals] = await Promise.all([
        priceQuery,
        supabase.from('technical_snapshots').select('*').eq('symbol_id', symbolRow.id).eq('timeframe', timeframe).order('as_of_date', { ascending: false }).limit(1),
        supabase.from('pattern_instances').select('*').eq('symbol_id', symbolRow.id).eq('timeframe', timeframe).order('as_of_date', { ascending: false }).order('quality_score', { ascending: false }).limit(8),
        supabase.from('support_resistance_zones').select('id,zone_type,lower_price,upper_price,touches,strength,as_of_date').eq('symbol_id', symbolRow.id).eq('timeframe', timeframe).eq('active', true).order('as_of_date', { ascending: false }).order('strength', { ascending: false }).limit(24),
        supabase.from('disclosures').select('id,title,category,published_at,available_from,source,source_url').eq('symbol_id', symbolRow.id).order('published_at', { ascending: false }).limit(6),
        supabase.from('fundamental_periods').select('id,period_end,published_at,available_from,source,fundamental_metrics(revenue,eps,roe,debt_to_equity,operating_cash_flow)').eq('symbol_id', symbolRow.id).lte('available_from', new Date().toISOString().slice(0, 10)).order('period_end', { ascending: false }).limit(4),
      ])
      const failure = prices.error || technical.error || patterns.error || zones.error || disclosures.error || fundamentals.error
      if (failure) throw failure
      return {
        symbol: symbolRow,
        prices: ((prices.data ?? []) as PriceBar[]).reverse(),
        technical: (technical.data ?? []) as TechnicalSnapshot[],
        patterns: (patterns.data ?? []) as PatternInstance[],
        zones: latestUniqueZones((zones.data ?? []) as PriceZone[]),
        disclosures: disclosures.data ?? [],
        fundamentals: (fundamentals.data ?? []) as FundamentalPeriod[],
      }
    },
  })
}

function latestUniqueZones(rows: PriceZone[]): PriceZone[] {
  const latestDate = rows[0]?.as_of_date
  const seen = new Set<string>()
  return rows.filter(zone => {
    if (zone.as_of_date !== latestDate) return false
    const key = `${zone.zone_type}:${Number(zone.lower_price).toFixed(3)}:${Number(zone.upper_price).toFixed(3)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 6)
}
