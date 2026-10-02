import { supabase } from './supabase'

export type SignalPublication = { date: string; count: number; finishedAt: string | null; sourceRevision: string; publicationStatus: 'COMPLETE' | 'PARTIAL' | 'LEGACY'; covered: number | null; expected: number | null }
let cached: { value: SignalPublication | null; expires: number } | null = null
let pending: Promise<SignalPublication | null> | null = null
export function clearSignalPublicationCache() { cached = null }

export async function latestSignalPublication(): Promise<SignalPublication | null> {
  if (cached && cached.expires > Date.now()) return cached.value
  if (pending) return pending
  pending = readPublication().then(value => { cached = { value, expires: Date.now() + 60_000 }; return value }).finally(() => { pending = null })
  return pending
}

async function readPublication(): Promise<SignalPublication | null> {
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
  return { date: latest.trading_date, count: Number(latest.counts?.published_signals ?? 0), finishedAt: latest.finished_at, sourceRevision: latest.source_revision ?? 'legacy', publicationStatus: latest.counts?.publication_status ?? 'LEGACY', covered: latest.counts?.covered_symbols ?? null, expected: latest.counts?.expected_symbols ?? null }
}
