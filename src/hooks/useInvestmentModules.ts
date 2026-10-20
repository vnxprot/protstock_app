import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { latestSignalPublication } from '../lib/signalPublication'
import type { MarketContext, ModuleRow, Review } from '../lib/investmentModules'

export function useInvestmentModules(authenticated: boolean, ownerId?: string, canReview = false) {
  const publication = useQuery({ queryKey: ['signal-publication'], enabled: authenticated && Boolean(supabase), staleTime: 60_000, queryFn: latestSignalPublication })
  const data = useQuery({
    queryKey: ['investment-modules', publication.data?.date, publication.data?.sourceRevision, ownerId, canReview],
    enabled: authenticated && Boolean(supabase) && !publication.isPending,
    staleTime: 300_000,
    queryFn: async () => {
      if (publication.error) throw publication.error
      const [current, reviews, market] = await Promise.all([
        supabase!.from('investment_module_current').select('*').order('symbol_id').range(0, 999),
        canReview && ownerId ? supabase!.from('canslim_reviews').select('*').eq('user_id', ownerId).range(0, 999) : Promise.resolve({ data: [], error: null }),
        publication.data ? supabase!.from('market_breadth_snapshots').select('trading_date,market_health_state,coverage_status,vnindex_trend_state').eq('trading_date', publication.data.date).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ])
      if (current.error || reviews.error || market.error) throw current.error || reviews.error || market.error
      return { current: current.data as ModuleRow[], reviews: reviews.data as Review[], market: market.data as MarketContext | null }
    },
  })
  return { ...data, publication: publication.data, publicationError: publication.error, publicationLoading: publication.isLoading }
}
