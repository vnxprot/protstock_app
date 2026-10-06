import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { signalReasonSummary } from '../lib/signalExplanation'
import { filterSignalGroups, groupSignals, signalGroupPage, unsettledLotStates, type SectorStrength, type TriageFocus, type TriageHolding, type TriageSignal } from '../lib/signalTriage'
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
  const lotStates = useQuery({ queryKey: ['signal-triage-lots', latestDate], enabled: Boolean(supabase) && Boolean(latestDate), queryFn: async () => {
    const transactions: { symbol_id: number; trading_date: string; action: string; quantity: number; created_at: string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('portfolio_transactions')
        .select('symbol_id,trading_date,action,quantity,created_at').lte('trading_date', latestDate)
        .order('trading_date').order('created_at').range(from, from + 999)
      if (error) throw error
      transactions.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
    const sessions = await supabase!.from('market_breadth_snapshots').select('trading_date').lte('trading_date', latestDate).order('trading_date', { ascending: false }).limit(20)
    if (sessions.error) throw sessions.error
    return unsettledLotStates(transactions, latestDate, (sessions.data ?? []).map(row => row.trading_date))
  } })
  const sectorStrength = useQuery({ queryKey: ['signal-triage-sector', latestDate], enabled: Boolean(supabase) && Boolean(latestDate), queryFn: async () => {
    const { data, error } = await supabase!.from('market_breadth_snapshots').select('sector_breadth').eq('trading_date', latestDate).maybeSingle()
    if (error) throw error
    const sectors = (data?.sector_breadth ?? []) as (SectorStrength & { sector: string })[]
    return new Map(sectors.map(row => [row.sector, row]))
  } })
  const extension = useQuery({ queryKey: ['signal-triage-extension', latestDate], enabled: Boolean(supabase) && Boolean(latestDate), queryFn: async () => {
    const result = new Map<number, number>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('signals').select('symbol_id,evidence')
        .eq('as_of_date', latestDate).eq('timeframe', 'D').order('symbol_id').range(from, from + 999)
      if (error) throw error
      for (const row of data ?? []) {
        const evidence = row.evidence as { close?: number; base_price?: number; invalidation_price?: number; trigger_price?: number } | null
        const close = Number(evidence?.close), base = Number(evidence?.base_price ?? evidence?.trigger_price ?? evidence?.invalidation_price)
        if (close > 0 && base > 0) {
          const distance = (close / base - 1) * 100
          result.set(Number(row.symbol_id), Math.max(result.get(Number(row.symbol_id)) ?? -Infinity, distance))
        }
      }
      if ((data ?? []).length < 1000) break
    }
    return result
  } })
  const allGroups = useMemo(() => {
    const visibleIds = new Set(rows.map(row => row.symbol_id))
    return groupSignals(allRows.filter(row => row.as_of_date === latestDate),
      previous.isSuccess ? previous.data : null, positions.data ?? new Set<number>(),
      { settlement: lotStates.data, sectors: sectorStrength.data, extensionPct: extension.data })
      .filter(group => visibleIds.has(group.symbol_id))
  }, [rows, allRows, latestDate, previous.isSuccess, previous.data, positions.data, lotStates.data, sectorStrength.data, extension.data])
  const groups = useMemo(() => filterSignalGroups(allGroups, focus, holding), [allGroups, focus, holding])
  useEffect(() => setPage(1), [focus, holding, latestDate])
  const pageCount = Math.max(1, Math.ceil(groups.length / 10))
  const currentPage = Math.min(page, pageCount)
  const visibleGroups = signalGroupPage(groups, currentPage)
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
    <p className="muted">Đọc nhãn: EXTENDED là % giá đóng cửa cao hơn nền/trigger/stop tham chiếu, cảnh báo khi vượt 7%; “Ngành” là điểm sức khỏe 0–100, GTGD là tỷ trọng giao dịch của ngành trong universe phiên này, không phải dòng tiền ròng. Xem Cài đặt → Hướng dẫn để có ví dụ.</p>
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
          {group.settlement?.map((state, index) => <b className="triage-held" key={`${state}-${index}`}>{state}</b>)}
          {group.extensionPct != null && group.extensionPct > 7 && <b className="triage-extension" title="Giá đóng cửa cao hơn mốc nền, trigger hoặc stop tham chiếu; không phải lợi nhuận vị thế">EXTENDED (+{group.extensionPct.toFixed(1)}%)</b>}
          {group.sectorStrength && <b className="triage-sector" title="Điểm sức khỏe ngành · tỷ trọng giá trị giao dịch ước tính của ngành trong universe, không phải dòng tiền ròng">Ngành {Number(group.sectorStrength.market_health_score ?? 0).toFixed(0)} · GTGD {Number(group.sectorStrength.turnover_share_pct ?? 0).toFixed(1)}%</b>}
          {group.primary.action !== 'WATCH' && <b className="triage-action">{group.primary.action}</b>}</span>
        <span className="triage-reason">{signalReasonSummary(group.primary.reasons)}</span>
        <span className="triage-count">{group.signals.length} tín hiệu {open ? '▴' : '▾'}</span></button>
      {open && <div id={`triage-details-${group.symbol_id}`} className="triage-details">{group.signals.map(signal => <div key={signal.signal_id} className="triage-detail-row">
        <b>{signal.timeframe} · {signal.action}</b><span>{signalReasonSummary(signal.reasons)}</span>
        <button type="button" onClick={() => onExplain(signal)}>Vì sao?</button>
      </div>)}</div>}
    </article>})}
    {!groups.length && <p className="muted">Chưa có tín hiệu khớp bộ lọc.</p>}
    {groups.length > 10 && <nav className="triage-pagination" aria-label="Phân trang bảng gộp">
      <span>Trang {currentPage}/{pageCount} · {Math.min((currentPage - 1) * 10 + 1, groups.length)}–{Math.min(currentPage * 10, groups.length)} / {groups.length} mã</span>
      <div><button type="button" disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>‹ Trước</button>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Sau ›</button></div>
    </nav>}
  </div>
}
