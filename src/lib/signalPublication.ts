import { supabase } from './supabase'

export async function latestSignalPublication(): Promise<{ date: string; count: number; finishedAt: string | null; sourceRevision: string } | null> {
  const { data, error } = await supabase!.from('job_runs')
    .select('trading_date,counts,finished_at,source_revision')
    .eq('status', 'SUCCEEDED')
    .not('counts->>published_signals', 'is', null)
    .order('trading_date', { ascending: false })
    .order('finished_at', { ascending: false })
    .limit(20)
  if (error) throw error
  const latest = (data ?? []).find(item => {
    const day = new Date(`${item.trading_date}T00:00:00Z`).getUTCDay()
    return day >= 1 && day <= 5
  })
  if (!latest) return null
  return { date: latest.trading_date, count: Number(latest.counts?.published_signals ?? 0), finishedAt: latest.finished_at, sourceRevision: latest.source_revision ?? 'legacy' }
}
