import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDate } from '../lib/date'
import { signalReasonSummary } from '../lib/signalExplanation'
import { groupSignals, type TriageSignal } from '../lib/signalTriage'
import { supabase } from '../lib/supabase'

type Props = { rows: TriageSignal[]; allRows: TriageSignal[]; latestDate: string; onSelect: (symbol: string) => void }

async function loadPrevious(date: string): Promise<TriageSignal[] | null> {
  const { data: jobs, error: jobError } = await supabase!.from('job_runs')
    .select('trading_date,source_revision,counts').eq('status', 'SUCCEEDED')
    .not('counts->>published_signals', 'is', null).lt('trading_date', date)
    .order('trading_date', { ascending: false }).order('finished_at', { ascending: false }).limit(20)
  if (jobError) throw jobError
  const previous = (jobs ?? []).find(job => {
    const day = new Date(`${job.trading_date}T00:00:00Z`).getUTCDay()
    return day >= 1 && day <= 5
  })
  if (!previous) return null
  const rows: TriageSignal[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase!.from('consolidated_signals')
      .select('id,symbol_id,as_of_date,timeframe,composite_action,signal_state,confluence_score,reasons,symbols!inner(symbol,sector)')
      .eq('as_of_date', previous.trading_date).eq('source_revision', previous.source_revision ?? 'legacy')
      .range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []).map((item: any) => {
      const symbol = Array.isArray(item.symbols) ? item.symbols[0] : item.symbols
      return { signal_id: item.id, symbol_id: Number(item.symbol_id), symbol: symbol?.symbol ?? '—',
        sector: symbol?.sector ?? null, as_of_date: item.as_of_date, timeframe: item.timeframe,
        action: item.composite_action, state: item.signal_state, score: Number(item.confluence_score),
        reasons: item.reasons ?? [] }
    }))
    if ((data ?? []).length < 1000) break
  }
  return rows
}

const changeLabels = { new: 'Mới xuất hiện', action: 'Đổi tín hiệu', reasons: 'Lý do mới', continued: 'Tiếp diễn', unknown: 'Chưa có phiên đối chiếu' }

export function SignalTriageList({ rows, allRows, latestDate, onSelect }: Props) {
  const previous = useQuery({ queryKey: ['signal-triage-previous', latestDate], enabled: Boolean(supabase) && Boolean(latestDate),
    staleTime: 300_000, queryFn: () => loadPrevious(latestDate) })
  const positions = useQuery({ queryKey: ['signal-triage-positions'], enabled: Boolean(supabase),
    staleTime: 60_000, refetchInterval: 60_000, queryFn: async () => {
      const { data, error } = await supabase!.from('positions').select('symbol_id,quantity').gt('quantity', 0)
      if (error) throw error
      return new Set((data ?? []).map(item => Number(item.symbol_id)))
    } })
  const groups = useMemo(() => {
    const visibleIds = new Set(rows.map(row => row.symbol_id))
    return groupSignals(allRows.filter(row => row.as_of_date === latestDate),
      previous.isSuccess ? previous.data : null, positions.data ?? new Set<number>())
      .filter(group => visibleIds.has(group.symbol_id))
  }, [rows, allRows, latestDate, previous.isSuccess, previous.data, positions.data])
  const signalCount = groups.reduce((count, group) => count + group.signals.length, 0)
  const repeated = signalCount - groups.length

  return <div className="signal-triage">
    <div className="signal-triage-summary"><strong>{groups.length} mã từ {signalCount} tín hiệu</strong>
      <span>{repeated > 0 ? `Đã gộp ${repeated} tín hiệu cùng mã.` : 'Mỗi mã có một tín hiệu.'} Ưu tiên thay đổi mới và mã đang nắm giữ.</span></div>
    {(previous.isError || positions.isError) && <p className="muted" role="status">{previous.isError ? 'Chưa đọc được phiên trước; thứ tự tạm thời chưa tính thay đổi mới. ' : ''}{positions.isError ? 'Chưa đọc được danh mục; thứ tự tạm thời chưa tính vị thế.' : ''}</p>}
    {groups.map(group => <details className="signal-triage-group" key={group.symbol_id}>
      <summary><span className="triage-symbol"><strong>{group.symbol}</strong><small>{group.sector ?? 'Chưa phân ngành'}</small></span>
        <span className="triage-labels">{group.held && <b className="triage-held">Đang nắm giữ</b>}
          <b className="triage-change">{changeLabels[group.change]}</b>
          {group.risk && <b className="triage-risk">WATCH · Rủi ro tăng</b>}
          {group.opportunity && <b className="triage-opportunity">WATCH · Cơ hội hình thành</b>}</span>
        <span className="triage-snapshot"><b>{group.primary.action}</b><small>{group.signals.map(item => item.timeframe).join(' · ')} · Điểm cao nhất {Math.max(...group.signals.map(item => item.score))}</small></span>
        <span className="triage-reason">{signalReasonSummary(group.primary.reasons)}</span>
        <span className="triage-count">{group.signals.length} tín hiệu ▾</span></summary>
      <div className="triage-details">{group.signals.map(signal => <div key={signal.signal_id} className="triage-detail-row">
        <b>{signal.timeframe} · {signal.action}</b><span>{signalReasonSummary(signal.reasons)}</span>
        <button type="button" onClick={() => onSelect(signal.symbol)}>Xem phân tích</button>
      </div>)}<small>Nhãn WATCH chỉ hỗ trợ sắp xếp việc nghiên cứu; không tự tạo lệnh giao dịch. Phiên {formatDate(latestDate)}.</small></div>
    </details>)}
    {!groups.length && <p className="muted">Chưa có tín hiệu khớp bộ lọc.</p>}
  </div>
}
