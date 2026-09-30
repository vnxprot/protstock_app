import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { signalReasonSummary } from '../lib/signalExplanation'
import { filterSignalGroups, groupSignals, signalGroupPage, type TriageFocus, type TriageHolding, type TriageSignal } from '../lib/signalTriage'
import { supabase } from '../lib/supabase'
import { SoftSelect } from './SoftSelect'

type Props = { rows: TriageSignal[]; allRows: TriageSignal[]; latestDate: string; onExplain: (signal: TriageSignal) => void }

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

export function SignalTriageList({ rows, allRows, latestDate, onExplain }: Props) {
  const [focus, setFocus] = useState<TriageFocus>('all')
  const [holding, setHolding] = useState<TriageHolding>('all')
  const [expandedAll, setExpandedAll] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set())
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(() => new Set())
  const [page, setPage] = useState(1)
  const previous = useQuery({ queryKey: ['signal-triage-previous', latestDate], enabled: Boolean(supabase) && Boolean(latestDate),
    staleTime: 300_000, queryFn: () => loadPrevious(latestDate) })
  const positions = useQuery({ queryKey: ['signal-triage-positions'], enabled: Boolean(supabase),
    staleTime: 60_000, refetchInterval: 60_000, queryFn: async () => {
      const { data, error } = await supabase!.from('positions').select('symbol_id,quantity').gt('quantity', 0)
      if (error) throw error
      return new Set((data ?? []).map(item => Number(item.symbol_id)))
    } })
  const allGroups = useMemo(() => {
    const visibleIds = new Set(rows.map(row => row.symbol_id))
    return groupSignals(allRows.filter(row => row.as_of_date === latestDate),
      previous.isSuccess ? previous.data : null, positions.data ?? new Set<number>())
      .filter(group => visibleIds.has(group.symbol_id))
  }, [rows, allRows, latestDate, previous.isSuccess, previous.data, positions.data])
  const groups = useMemo(() => filterSignalGroups(allGroups, focus, holding), [allGroups, focus, holding])
  useEffect(() => setPage(1), [focus, holding, rows, latestDate])
  const pageCount = Math.max(1, Math.ceil(groups.length / 10))
  const currentPage = Math.min(page, pageCount)
  const visibleGroups = expandedAll ? signalGroupPage(groups, currentPage) : groups
  const signalCount = allGroups.reduce((count, group) => count + group.signals.length, 0)
  const repeated = signalCount - allGroups.length

  function toggleGroup(id: number) {
    if (expandedAll) setCollapsedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    else setExpandedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function openAll() { setExpandedAll(true); setCollapsedIds(new Set()); setPage(1) }
  function collapseAll() { setExpandedAll(false); setExpandedIds(new Set()); setCollapsedIds(new Set()) }

  return <div className="signal-triage">
    <div className="signal-triage-summary"><strong>{allGroups.length} mã từ {signalCount} tín hiệu</strong>
      <span>{repeated > 0 ? `Đã gộp ${repeated} tín hiệu cùng mã.` : 'Mỗi mã có một tín hiệu.'} Thứ tự: thay đổi mới → rủi ro trong danh mục → WATCH cơ hội.</span></div>
    <div className="signal-triage-toolbar" aria-label="Bộ lọc bảng gộp">
      <label>Nhóm ưu tiên<SoftSelect aria-label="Lọc nhóm ưu tiên" value={focus} onChange={event => setFocus(event.target.value as TriageFocus)}>
        <option value="all">Tất cả nhóm</option><option value="changed">Thay đổi mới</option>
        <option value="held_risk">Rủi ro trong danh mục</option><option value="opportunity">WATCH · Cơ hội hình thành</option>
        <option value="other">Còn lại</option>
      </SoftSelect></label>
      <label>Vị thế<SoftSelect aria-label="Lọc vị thế" value={holding} onChange={event => setHolding(event.target.value as TriageHolding)}>
        <option value="all">Mọi mã</option><option value="held">Đang nắm giữ</option><option value="unheld">Chưa nắm giữ</option>
      </SoftSelect></label>
      <span>{groups.length} mã khớp bộ lọc</span>
      <div className="triage-expand-actions"><button type="button" onClick={openAll} disabled={expandedAll && collapsedIds.size === 0}>Mở tất cả</button><button type="button" onClick={collapseAll} disabled={!expandedAll && expandedIds.size === 0}>Thu gọn</button></div>
    </div>
    {(previous.isError || positions.isError) && <p className="muted" role="status">{previous.isError ? 'Chưa đọc được phiên trước; thứ tự tạm thời chưa tính thay đổi mới. ' : ''}{positions.isError ? 'Chưa đọc được danh mục; thứ tự tạm thời chưa tính vị thế.' : ''}</p>}
    {visibleGroups.map(group => {
      const open = expandedAll ? !collapsedIds.has(group.symbol_id) : expandedIds.has(group.symbol_id)
      return <article className={`signal-triage-group ${open ? 'open' : ''}`} key={group.symbol_id}>
      <button type="button" className="triage-summary-row" aria-expanded={open} aria-controls={open ? `triage-details-${group.symbol_id}` : undefined} onClick={() => toggleGroup(group.symbol_id)}>
        <span className="triage-symbol"><strong>{group.symbol}</strong><small>{group.sector ?? 'Chưa phân ngành'}</small></span>
        <span className="triage-labels"><b className="triage-change">{changeLabels[group.change]}</b>
          {group.risk && <b className="triage-risk">WATCH · Rủi ro tăng</b>}
          {group.opportunity && <b className="triage-opportunity">WATCH · Cơ hội hình thành</b>}
          {group.held && <b className="triage-held">Đang nắm giữ</b>}
          {group.primary.action !== 'WATCH' && <b className="triage-action">{group.primary.action}</b>}</span>
        <span className="triage-reason">{signalReasonSummary(group.primary.reasons)}</span>
        <span className="triage-count">{group.signals.length} tín hiệu {open ? '▴' : '▾'}</span></button>
      {open && <div id={`triage-details-${group.symbol_id}`} className="triage-details">{group.signals.map(signal => <div key={signal.signal_id} className="triage-detail-row">
        <b>{signal.timeframe} · {signal.action}</b><span>{signalReasonSummary(signal.reasons)}</span>
        <button type="button" onClick={() => onExplain(signal)}>Vì sao?</button>
      </div>)}</div>}
    </article>})}
    {!groups.length && <p className="muted">Chưa có tín hiệu khớp bộ lọc.</p>}
    {expandedAll && groups.length > 10 && <nav className="triage-pagination" aria-label="Phân trang bảng gộp">
      <span>Trang {currentPage}/{pageCount} · {Math.min((currentPage - 1) * 10 + 1, groups.length)}–{Math.min(currentPage * 10, groups.length)} / {groups.length} mã</span>
      <div><button type="button" disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>‹ Trước</button>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Sau ›</button></div>
    </nav>}
  </div>
}
