import { supabase } from './supabase'

export async function latestSignalPublication(): Promise<{ date: string; count: number } | null> {
  const { data, error } = await supabase!.from('job_runs')
    .select('trading_date,counts')
    .eq('status', 'SUCCEEDED')
    .not('counts->>published_signals', 'is', null)
    .order('trading_date', { ascending: false })
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { date: data.trading_date, count: Number(data.counts?.published_signals ?? 0) }
}
