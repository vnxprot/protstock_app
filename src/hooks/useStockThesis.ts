import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAccountId } from './useAccountId'

export type ThesisStatus = 'OBSERVATION' | 'MAINTAIN' | 'REVIEW' | 'INVALIDATED'
export type ThesisVersion = { id: string; version: number; thesis: string; catalysts: string; invalidation_conditions: string; risk_notes: string; review_status: ThesisStatus; created_at: string }
export type StockThesis = { id: string; user_id: string; symbol_id: number; symbol: string; current_version_id: string; current_version: ThesisVersion; updated_at: string }

export function useStockThesis(symbol: string, authenticated = true) {
  const userId = useAccountId(authenticated)
  return useQuery<StockThesis | null>({
    queryKey: ['stock-thesis', userId, symbol], enabled: Boolean(supabase && userId && symbol), staleTime: 30_000,
    queryFn: async () => {
      const { data: instrument, error: instrumentError } = await supabase!.from('symbols').select('id').eq('symbol', symbol).single()
      if (instrumentError) throw instrumentError
      const { data, error } = await supabase!.from('investment_theses').select('id,user_id,symbol_id,current_version_id,updated_at').eq('user_id', userId!).eq('symbol_id', instrument.id).maybeSingle()
      if (error) throw error
      if (!data?.current_version_id) return null
      const { data: version, error: versionError } = await supabase!.from('investment_thesis_versions').select('id,version,thesis,catalysts,invalidation_conditions,risk_notes,review_status,created_at').eq('id', data.current_version_id).single()
      if (versionError) throw versionError
      return { ...data, symbol, current_version: version as ThesisVersion }
    },
  })
}
