import { Activity, Database, ShieldAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { formatDate } from '../lib/date'
import { supabase } from '../lib/supabase'

export function TodayHealth() {
  const health = useQuery({
    queryKey: ['today-health-detail'],
    enabled: Boolean(supabase),
    staleTime: 60_000,
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured')
      const [{ count: priceRows, error: priceError }, { count: coveredSymbols, error: coverageError }, { data: signals, error: signalError }, { data: jobs, error: jobError }, { count: activeSymbols, error: universeError }] = await Promise.all([
        supabase.from('daily_prices').select('symbol_id', { count: 'exact', head: true }),
        supabase.from('latest_daily_prices').select('symbol_id', { count: 'exact', head: true }),
        supabase.from('signals').select('source,action,as_of_date').order('as_of_date', { ascending: false }).limit(205),
        supabase.from('job_runs').select('id,status,trading_date,counts,warnings,started_at').eq('job_type', 'EOD_INGEST').order('started_at', { ascending: false }).limit(8),
        supabase.from('symbols').select('id', { count: 'exact', head: true }).eq('active', true),
      ])
      if (priceError || coverageError || signalError || jobError || universeError) throw priceError || coverageError || signalError || jobError || universeError
      const job = jobs?.[0]
      const attentionJob = (jobs ?? []).find(candidate => candidate.status === 'PARTIAL' || candidate.status === 'FAILED')
      const { data: failedItems, error: failedError } = attentionJob
        ? await supabase.from('job_run_items').select('item_key,error_code').eq('job_run_id', attentionJob.id).eq('status', 'FAILED').order('item_key')
        : { data: [], error: null }
      if (failedError) throw failedError
      const newestDate = signals?.[0]?.as_of_date
      const todaySignals = (signals ?? []).filter(signal => signal.as_of_date === newestDate)
      return {
        priceRows: priceRows ?? 0, coveredSymbols: coveredSymbols ?? 0, activeSymbols: activeSymbols ?? 0, newestDate,
        coreActions: todaySignals.filter(signal => signal.source === 'CORE_ENGINE' && signal.action !== 'WATCH').length,
        coreWatch: todaySignals.filter(signal => signal.source === 'CORE_ENGINE' && signal.action === 'WATCH').length,
        job, attentionJob, failedItems: failedItems ?? [],
      }
    },
  })
  const data = health.data
  return <article className="panel discipline-card today-health-card">
    <div className="panel-title"><div><span className="eyebrow">DATA HEALTH · HÔM NAY</span><h2>Dữ liệu và pipeline</h2></div><Activity size={23}/></div>
    {health.isLoading ? <p className="muted">Đang kiểm tra độ phủ dữ liệu…</p> : health.isError ? <p className="negative">Không tải được trạng thái dữ liệu.</p> : <>
      <div className="health-metrics"><span><Database size={15}/><b>{data?.coveredSymbols ?? 0}/{data?.activeSymbols ?? 0}</b><small>Mã có giá</small></span><span><b>{(data?.priceRows ?? 0).toLocaleString('vi-VN')}</b><small>Bản ghi giá</small></span><span><b>{data?.coreActions ?? 0}</b><small>Action mới</small></span><span><b>{data?.coreWatch ?? 0}</b><small>Core WATCH</small></span></div>
      <p>Dữ liệu signal mới nhất: <strong>{data?.newestDate ? formatDate(data.newestDate) : 'chưa có'}</strong>. EOD gần nhất: <strong>{data?.job?.trading_date ? formatDate(data.job.trading_date) : 'chưa có'}</strong> · {data?.job?.status ?? '—'}.</p>
      {data?.failedItems.length ? <div className="health-errors"><ShieldAlert size={15}/><span>{data.failedItems.length} mã cần retry ({formatDate(data.attentionJob?.trading_date)}): {data.failedItems.map(item => item.item_key).join(', ')}</span></div> : <div className="health-ok">Không có mã lỗi trong các EOD gần đây.</div>}
    </>}
  </article>
}
