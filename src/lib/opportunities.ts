import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type Opportunity = {
  symbol_id: number; symbol: string; sector: string | null; rank: number
  status: 'PRIORITY' | 'OBSERVE' | 'EXTENDED' | 'RISK' | 'INVALIDATED'
  change: string; first_seen: string; age_sessions: number; close: number; daily_pct: number
  system_action: string; monthly_state: string; reasons: string[]; risks: string[]; next_step: string
  trigger_price: number | null; invalidation_price: number | null; support_reference: number | null; resistance_reference: number | null
  recovery: boolean; burst: boolean; late_burst: boolean; setup: boolean
  families?: Array<'RECOVERY' | 'CONTINUATION' | 'UNUSUAL_VOLUME'>
  evidence: { ema20?: number; rsi14?: number; macd_histogram?: number; volume_ratio20?: number
    up_burst_share_pct: number; up_burst_value_vnd: number; minute_complete: boolean
    events: Array<{ id: number; start_time: string; end_time: string; volume: number; value_vnd: number; price_change_pct: number }>
    momentum_stage?: string; funnel_stage?: string; macd_stage?: string }
}
export type OpportunityPublication = { id?: string; trading_date?: string; published_at?: string; status: string
  version?: string; phase?: 'EOD' | 'RADAR'; pinned?: boolean; historical?: boolean; rows: Opportunity[]
  build?: { status: string; phase: string; attempt: number; started_at?: string; finished_at?: string; last_error?: string; retry_exhausted?: boolean } | null
  summary?: { radar_coverage?: string; priority?: number; total?: number; processed_symbols?: number; expected_symbols?: number; input_complete?: boolean; diagnostics?: Record<string, number> } }
export function hasOpportunityPublication(value?: OpportunityPublication): value is OpportunityPublication & { status: 'PUBLISHED' | 'PROVISIONAL' | 'STALE' } {
  return Boolean(value && ['PUBLISHED', 'PROVISIONAL', 'STALE'].includes(value.status))
}
export const opportunityStatus: Record<string, string> = {
  PRIORITY: 'Ưu tiên theo dõi', OBSERVE: 'Theo dõi thêm', EXTENDED: 'Đã kéo xa', RISK: 'Ưu tiên xử lý rủi ro', INVALIDATED: 'Mất hiệu lực',
}
export function opportunityRoute() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const day = params.get('date') ?? ''
  const publication = params.get('publication') ?? ''
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) ? day : '',
    publication: /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(publication) ? publication : '',
    symbol: /^[A-Z0-9]{2,8}$/.test(params.get('symbol') ?? '') ? params.get('symbol')! : '' }
}
export function useOpportunityRoute() {
  const [route, setRoute] = useState(opportunityRoute)
  useEffect(() => { const sync = () => setRoute(opportunityRoute()); addEventListener('hashchange', sync); return () => removeEventListener('hashchange', sync) }, [])
  return route
}
export function useOpportunities(day = '', publication = '', enabled = true) {
  return useQuery({ queryKey: ['next-session-opportunities', day, publication], enabled: enabled && Boolean(supabase),
    staleTime: publication ? Infinity : 60_000, refetchInterval: publication ? false : 60_000,
    queryFn: async (): Promise<OpportunityPublication> => {
      const { data, error } = await supabase!.rpc('get_opportunities', { p_day: day || null, p_publication: publication || null })
      if (error) throw error
      return { ...data, rows: data?.rows ?? [] }
    } })
}
export function opportunityHref(symbol: string, day?: string, publication?: string) {
  const query = new URLSearchParams({ symbol })
  if (day) query.set('date', day)
  if (publication) query.set('publication', publication)
  return '#analysis?' + query.toString()
}
