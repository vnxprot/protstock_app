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

export function useStockAnalysis(symbol: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['stock-analysis', symbol], enabled: enabled && Boolean(supabase) && Boolean(symbol), staleTime: 60_000,
    queryFn: async () => {
      if (!supabase || !symbol) throw new Error('Symbol is required')
      const { data: symbolRow, error: symbolError } = await supabase.from('symbols').select('id,symbol,sector,exchange,company_name').eq('symbol', symbol).single()
      if (symbolError) throw symbolError
      const [prices, technical, patterns, disclosures] = await Promise.all([
        supabase.from('daily_prices').select('trading_date,open,high,low,close,volume').eq('symbol_id', symbolRow.id).order('trading_date', { ascending: false }).limit(260),
        supabase.from('technical_snapshots').select('*').eq('symbol_id', symbolRow.id).order('as_of_date', { ascending: false }).limit(3),
        supabase.from('pattern_instances').select('*').eq('symbol_id', symbolRow.id).order('as_of_date', { ascending: false }).order('quality_score', { ascending: false }).limit(8),
        supabase.from('disclosures').select('id,title,category,published_at,available_from,source,source_url').eq('symbol_id', symbolRow.id).order('published_at', { ascending: false }).limit(6),
      ])
      const failure = prices.error || technical.error || patterns.error || disclosures.error
      if (failure) throw failure
      return {
        symbol: symbolRow,
        prices: ((prices.data ?? []) as PriceBar[]).reverse(),
        technical: (technical.data ?? []) as TechnicalSnapshot[],
        patterns: (patterns.data ?? []) as PatternInstance[],
        disclosures: disclosures.data ?? [],
      }
    },
  })
}

