import { Activity, ShieldAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { formatDate, formatDateTime } from '../lib/date'
import { supabase } from '../lib/supabase'
import { latestSignalPublication } from '../lib/signalPublication'

type EodItem = { item_key: string; status: string; error_code: string | null; error_message: string | null; warning_codes: string[] | null }

function Timestamp({ value }: { value: string | null | undefined }) {
  const [calendarDate, clock] = formatDateTime(value).split(' ')
  return <span className="health-timestamp"><time>{calendarDate ?? '—'}</time><b>{clock ?? '—'}</b></span>
}

export function TodayHealth() {
  const health = useQuery({
    queryKey: ['today-health-detail'],
    enabled: Boolean(supabase),
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured')
      const publication = await latestSignalPublication()
      const newestDate = publication?.date ?? null
      const [{ count: priceRows, error: priceError }, { count: coveredSymbols, error: coverageError }, { data: jobs, error: jobError }, { data: rebuildJobs, error: rebuildError }, { count: activeSymbols, error: universeError }] = await Promise.all([
        supabase.from('daily_prices').select('symbol_id', { count: 'exact', head: true }),
        newestDate ? supabase.from('technical_snapshots').select('symbol_id,symbols!inner(active)', { count: 'exact', head: true }).eq('symbols.active',true).eq('timeframe', 'D').eq('as_of_date', newestDate).eq('algorithm_version',publication!.sourceRevision) : Promise.resolve({ count: 0, error: null }),
        supabase.from('job_runs').select('id,status,trading_date,counts,warnings,started_at,finished_at').eq('job_type', 'EOD_INGEST').order('started_at', { ascending: false }).limit(8),
        supabase.from('job_runs').select('id,status,trading_date,counts,started_at,finished_at').eq('job_type', 'DERIVE_BARS').order('started_at', { ascending: false }).limit(8),
        supabase.from('symbols').select('id', { count: 'exact', head: true }).eq('active', true),
      ])
      if (priceError || coverageError || jobError || rebuildError || universeError) throw priceError || coverageError || jobError || rebuildError || universeError
      const [actionCount, watchCount] = newestDate ? await Promise.all([
        supabase.from('consolidated_signals').select('id', { count: 'exact', head: true }).eq('as_of_date', newestDate).eq('source_revision', publication!.sourceRevision).neq('composite_action', 'WATCH'),
        supabase.from('consolidated_signals').select('id', { count: 'exact', head: true }).eq('as_of_date', newestDate).eq('source_revision', publication!.sourceRevision).eq('composite_action', 'WATCH'),
      ]) : [{ count: 0, error: null }, { count: 0, error: null }]
      if (actionCount.error || watchCount.error) throw actionCount.error || watchCount.error
      const job = (jobs ?? []).find(candidate => candidate.trading_date === newestDate)
      const rebuildJob = (rebuildJobs ?? []).find(candidate => candidate.trading_date === newestDate)
      const signalUpdatedAt = publication?.finishedAt ?? null
      const attentionJob = (jobs ?? []).find(candidate => candidate.status === 'PARTIAL' || candidate.status === 'FAILED')
      const eodDate = jobs?.[0]?.trading_date ?? newestDate
      const sameDayJobs = (jobs ?? []).filter(candidate => candidate.trading_date === eodDate)
      const [{ data: universe, error: symbolsError }, { data: prices, error: dailyError }, { data: snapshots, error: snapshotsError }, { data: runItems, error: itemsError }] = await Promise.all([
        supabase.from('symbols').select('id,symbol').eq('active', true).order('symbol').limit(1000),
        eodDate ? supabase.from('daily_prices').select('symbol_id').eq('quality_status','VALID').eq('trading_date', eodDate).limit(1000) : Promise.resolve({ data: [], error: null }),
        eodDate ? supabase.from('technical_snapshots').select('symbol_id').eq('timeframe', 'D').eq('as_of_date', eodDate).limit(1000) : Promise.resolve({ data: [], error: null }),
        sameDayJobs.length ? supabase.from('job_run_items').select('item_key,status,error_code,error_message,warning_codes,job_run_id').in('job_run_id', sameDayJobs.map(item => item.id)).order('created_at', { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null }),
      ])
      if (symbolsError || dailyError || snapshotsError || itemsError) throw symbolsError || dailyError || snapshotsError || itemsError
      const priceIds = new Set((prices ?? []).map(item => Number(item.symbol_id)))
      const snapshotIds = new Set((snapshots ?? []).map(item => Number(item.symbol_id)))
      const itemBySymbol = new Map<string, EodItem>()
      for (const item of runItems ?? []) if (!itemBySymbol.has(item.item_key)) itemBySymbol.set(item.item_key, item)
      const missingEod = (universe ?? []).flatMap(item => {
        const hasPrice = priceIds.has(Number(item.id))
        const hasSnapshot = snapshotIds.has(Number(item.id))
        if (hasPrice && hasSnapshot) return []
        const runItem = itemBySymbol.get(item.symbol)
        const reason = runItem?.status === 'FAILED'
          ? [runItem.error_code, runItem.error_message].filter(Boolean).join(' · ')
          : runItem?.status === 'SKIPPED' ? (runItem.warning_codes ?? []).join(', ') || 'Job bỏ qua mã'
          : !runItem ? 'Chưa có kết quả EOD trong hai job' : !hasPrice ? 'Job hoàn tất nhưng thiếu giá đúng phiên' : 'Có giá nhưng chưa có snapshot D'
        return [{ symbol: item.symbol, reason }]
      })
      return {
        publicationStatus: publication?.publicationStatus ?? null, priceRows: priceRows ?? 0, coveredSymbols: coveredSymbols ?? 0, activeSymbols: activeSymbols ?? 0, newestDate,
        coreActions: actionCount.count ?? 0,
        coreWatch: watchCount.count ?? 0,
        latestSignalAt: signalUpdatedAt, job, rebuildJob, attentionJob, eodDate, missingEod,
      }
    },
  })
  const data = health.data
  return <article className="panel discipline-card today-health-card">
    <div className="panel-title"><div><h2>Dữ liệu và pipeline v1.0</h2></div><Activity size={23}/></div>
    {!supabase ? <p className="muted">Chưa kết nối dữ liệu.</p> : health.isLoading ? <p className="muted">Đang kiểm tra độ phủ dữ liệu…</p> : health.isError ? <p className="negative" role="alert">Không tải được trạng thái dữ liệu. <button className="text-button" onClick={()=>void health.refetch()}>Thử lại</button></p> : <>
      <div className="health-metrics"><span><b>{data?.newestDate && data.activeSymbols > 0 ? `${data.coveredSymbols}/${data.activeSymbols}` : '—'}</b><small>Mã có snapshot phiên {formatDate(data?.newestDate)}</small></span><span><b>{(data?.priceRows ?? 0).toLocaleString('vi-VN')}</b><small>Tổng bản ghi giá</small></span><span><b>{data?.coreActions ?? 0}</b><small>Action · phiên mới nhất</small></span><span><b>{data?.coreWatch ?? 0}</b><small>WATCH · phiên mới nhất</small></span></div>
      <dl className="health-details">
        <div><dt>Signal mới nhất</dt><dd><span>Phiên {formatDate(data?.newestDate)}</span><Timestamp value={data?.latestSignalAt}/></dd></div>
        <div><dt>EOD gần nhất · {data?.job?.status ?? '—'}</dt><dd><span>Phiên {formatDate(data?.job?.trading_date)}</span><Timestamp value={data?.job?.finished_at ?? data?.job?.started_at}/></dd></div>
        {data?.rebuildJob&&<div><dt>Chạy lại signal · {data.rebuildJob.status}</dt><dd><span>Phiên {formatDate(data.rebuildJob.trading_date)}</span><Timestamp value={data.rebuildJob.finished_at ?? data.rebuildJob.started_at}/></dd></div>}
        <div className="health-run-window"><dt>Thời gian xử lý EOD</dt><dd><span><small>Bắt đầu</small><Timestamp value={data?.job?.started_at}/></span><span><small>Hoàn tất</small><Timestamp value={data?.job?.finished_at}/></span></dd></div>
      </dl>
      {data?.missingEod.length ? <div className="health-errors"><ShieldAlert size={15}/><div><strong>{data.missingEod.length} mã chưa đủ EOD phiên {formatDate(data.eodDate)}</strong><ul className="health-missing-list">{data.missingEod.map(item=><li key={item.symbol}><b>{item.symbol}</b><span>{item.reason}</span></li>)}</ul></div></div> : (data?.activeSymbols ?? 0) > (data?.coveredSymbols ?? 0) ? <div className="health-errors"><ShieldAlert size={15}/><span>{(data?.activeSymbols ?? 0) - (data?.coveredSymbols ?? 0)} mã chưa có snapshot phiên {formatDate(data?.newestDate)}. Market Health và signal dùng các mã có dữ liệu đúng phiên.</span></div> : data?.newestDate && data.activeSymbols > 0 && data.publicationStatus === 'COMPLETE' && data.eodDate === data.newestDate ? <div className="health-ok">Dữ liệu EOD đã bao phủ toàn bộ mã đang hoạt động.</div> : <p className="muted">{data?.publicationStatus === 'PARTIAL' ? 'Phiên đang có dữ liệu thiếu; chưa công bố hoàn chỉnh.' : data?.newestDate ? 'Phiên lịch sử chưa có chứng nhận độ phủ theo chuẩn hiện tại.' : 'Chưa có phiên được công bố để đánh giá độ phủ.'}</p>}
    </>}
  </article>
}
