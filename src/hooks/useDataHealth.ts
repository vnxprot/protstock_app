import { useQuery } from '@tanstack/react-query'

import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'

export interface DataHealth {
  active_symbols: number
  latest_price_date: string | null
  price_warnings: number
  latest_disclosure_collection: string | null
  latest_successful_job: string | null
  failed_jobs_7d: number
}

export function useDataHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['data-health'],
    enabled: enabled && Boolean(supabase),
    staleTime: 60_000,
    queryFn: async (): Promise<DataHealth> => {
      if (!supabase) throw new Error('Supabase is not configured')
      const { data, error } = await supabase.from('data_health_summary').select('*').single()
      if (error) throw error
      return { ...(data as DataHealth), latest_price_date: formatDate(data.latest_price_date) }
    },
  })
}
