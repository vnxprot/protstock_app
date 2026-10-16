import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { formatMarketPrice } from '../lib/marketUnits'
import { funnelGroups, funnelResult, inFunnelGroup, setupDate, setupNames, sortFunnelRows, type FunnelGroup, type FunnelRow } from '../lib/challengerFunnel'
import { MonthlyTrendEvidence } from './MonthlyTrendEvidence'
import { ResearchPagination } from './ResearchPagination'
import { SoftSelect } from './SoftSelect'
import './SignalFunnelPanel.css'
import './ChallengerFunnelTable.css'

const dateText = (value?: string | null) => value ? formatDate(value) : '—'
const actionText = (value: string) => value === 'WATCH' ? 'Theo dõi' : value === 'PROBE_BUY' ? 'Mua thăm dò' : value

export function ChallengerFunnelTable({ date, focusSymbol = '' }: { date: string; focusSymbol?: string }) {
  const [search, setSearch] = useState(focusSymbol)
  const [group, setGroup] = useState<FunnelGroup>('ACTIVE')
  const [filters, setFilters] = useState({ action: '', market_regime: '', monthly_state: '', weekly_setup: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [opened, setOpened] = useState<number | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const switchAnchor = useRef<{ element: HTMLTableRowElement; top: number } | null>(null)
  // Switching closes the previous detail. Compensate only for that layout
  // change, keeping the clicked stock at its existing screen position.
  useLayoutEffect(() => {
    const anchor = switchAnchor.current
    switchAnchor.current = null
    if (anchor?.element.isConnected) {
      const shift = anchor.element.getBoundingClientRect().top - anchor.top
      if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: 'instant' })
    }
  }, [opened])
  useEffect(() => { if (focusSymbol) { setSearch(focusSymbol); setGroup('ALL'); setPage(1) } }, [focusSymbol])
  useEffect(() => { setPage(1); setOpened(null) }, [date])
  const query = useQuery({ queryKey: ['challenger-funnel-overview', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async (): Promise<FunnelRow[]> => {
    const rows: FunnelRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('challenger_strategy_assessments')
        .select('symbol_id,action,reasons,base_price,invalidation_price,evidence,symbols!inner(symbol)')
        .eq('trading_date', date).eq('engine_version', 'v0.0.0-challenger-trend1').eq('strategy_code', 'ADAPTIVE_FUNNEL')
        .order('symbol_id').range(from, from + 999)
      if (error) throw error
      rows.push(...(data ?? []).map((row: any) => ({ ...row, evidence: row.evidence ?? {}, reasons: row.reasons ?? [],
        symbol: (Array.isArray(row.symbols) ? row.symbols[0] : row.symbols)?.symbol ?? `#${row.symbol_id}` })))
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })
  const all = query.data ?? []
  const rows = all.filter(row => inFunnelGroup(row, group) && row.symbol.toUpperCase().includes(search.trim().toUpperCase())
    && (!filters.action || row.action === filters.action)
    && (!filters.market_regime || row.evidence.market_regime === filters.market_regime)
    && (!filters.monthly_state || row.evidence.monthly_state === filters.monthly_state)
    && (!filters.weekly_setup || row.evidence.weekly_setup === filters.weekly_setup)
  ).sort(sortFunnelRows)
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)))
  const change = (key: keyof typeof filters, value: string) => { setFilters(previous => ({ ...previous, [key]: value })); setPage(1); setOpened(null) }
  const activeFilters = Object.values(filters).filter(Boolean).length
  return <article className="panel challenger-funnel-panel">
    <div className="panel-title"><div><h3>Phễu MTF Challenger · tín hiệu riêng</h3><small>Tháng → setup tuần → kích hoạt ngày</small></div><strong>Phiên đánh giá: {dateText(date)}</strong></div>
    <p className="muted">Ngày kích hoạt là lần xác nhận đầu tiên của setup hiện tại. Tuổi tính bằng số phiên thị trường sau ngày đó; phiên kích hoạt = 0. Tín hiệu EOD, điểm mua giả định sớm nhất là Open phiên sau.</p>
    <div className="signal-funnel-counts funnel-quick-groups" role="group" aria-label="Nhóm tín hiệu và bộ lọc">{(Object.keys(funnelGroups) as FunnelGroup[]).map(key => <button key={key} type="button" aria-pressed={group === key} className={group === key ? 'selected' : ''} onClick={() => { setGroup(key); setPage(1); setOpened(null) }}>{funnelGroups[key]} ({all.filter(row => inFunnelGroup(row, key)).length})</button>)}
      <label className="screener-field screener-search"><Search size={15}/><input aria-label="Tìm mã phễu Challenger" value={search} placeholder="Tìm mã…" onChange={event => { setSearch(event.target.value); setPage(1); setOpened(null) }}/></label>
      <button type="button" className={`signal-funnel-filter-toggle${advancedOpen ? ' selected' : ''}`} aria-expanded={advancedOpen} aria-controls="challenger-funnel-filters" onClick={() => setAdvancedOpen(value => !value)}><SlidersHorizontal size={15}/> Bộ lọc{activeFilters ? ` (${activeFilters})` : ''}</button>
    </div>
    <p className="funnel-result-count">{rows.length}/{all.length} mã</p>
    {advancedOpen && <div id="challenger-funnel-filters" className="signal-search-advanced funnel-advanced">
      {([['action', 'Hành động'], ['market_regime', 'Thị trường'], ['monthly_state', 'Tháng'], ['weekly_setup', 'Setup tuần']] as const).map(([key, label]) => <label key={key}>{label}<SoftSelect value={filters[key]} onChange={event => change(key, event.target.value)}><option value="">Tất cả</option>{[...new Set(all.map(row => key === 'action' ? row.action : row.evidence[key]).filter((value): value is string => Boolean(value)))].sort().map(value => <option key={value} value={value}>{key === 'weekly_setup' ? setupNames[value] ?? value : key === 'action' ? actionText(value) : value}</option>)}</SoftSelect></label>)}
      <button type="button" className="secondary-button" onClick={() => { setFilters({ action: '', market_regime: '', monthly_state: '', weekly_setup: '' }); setSearch(''); setPage(1); setOpened(null) }}>Xóa bộ lọc</button>
    </div>}
    {query.isLoading && <p>Đang tải phễu Challenger…</p>}
    {query.isError && <p className="form-error" role="alert">Không đọc được phễu Challenger.</p>}
    {!query.isLoading && !query.isError && <><table className="funnel-overview"><caption className="funnel-caption">Mở từng mã để xem giá, stop và lý do chi tiết. “—” nghĩa là chưa có mốc hoặc chưa đủ dữ liệu; không lấy ngày đánh giá thay ngày kích hoạt.</caption><thead><tr>{['Mã', 'Tháng', 'Giai đoạn', 'Setup tuần · ngày tạo', 'Ngày kích hoạt', 'Tuổi trigger', 'Kết quả'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
      {rows.slice((current - 1) * pageSize, current * pageSize).map(row => {
        const info = row.evidence
        const expanded = opened === row.symbol_id
        return <Fragment key={row.symbol_id}><tr className={`funnel-summary${info.funnel_stage === 'DAILY_TRIGGER' ? ' funnel-fresh' : ''}${expanded ? ' is-expanded' : ''}`}>
          <td data-label="Mã"><button type="button" className="funnel-symbol" aria-expanded={expanded} aria-controls={`funnel-detail-${row.symbol_id}`} onClick={event => {
            const element = event.currentTarget.closest('tr')
            if (opened !== null && !expanded && element) switchAnchor.current = { element, top: element.getBoundingClientRect().top }
            setOpened(expanded ? null : row.symbol_id)
          }}>{row.symbol} {expanded ? '▾' : '▸'}</button></td>
          <td data-label="Tháng">{info.monthly_state ?? '—'}</td><td data-label="Giai đoạn">{funnelGroups[info.funnel_stage as FunnelGroup] ?? 'Chưa xác định'}</td>
          <td data-label="Setup tuần · ngày tạo">{setupNames[info.weekly_setup ?? ''] ?? info.weekly_setup ?? '—'}<small>{dateText(setupDate(row))}</small></td>
          <td data-label="Ngày kích hoạt">{dateText(info.trigger_date)}</td><td data-label="Tuổi trigger">{info.trigger_date && info.trigger_age_sessions != null ? `${info.trigger_age_sessions} phiên` : '—'}</td>
          <td data-label="Kết quả"><b className={`action-pill ${row.action.toLowerCase()}`}>{actionText(row.action)}</b><small>{funnelResult(row)}</small></td>
        </tr><tr id={`funnel-detail-${row.symbol_id}`} hidden={!expanded} className="funnel-detail"><td colSpan={7}>{expanded && <div>
          <h4>{row.symbol} · Chi tiết tín hiệu · {dateText(date)}</h4>
          <div className="challenger-research-facts"><span>Nền <b>{formatMarketPrice(row.base_price)}</b></span><span>Stop <b>{formatMarketPrice(row.invalidation_price)}</b></span><span>Xa stop <b>{info.distance_to_stop_pct == null ? '—' : `${info.distance_to_stop_pct.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`}</b></span><span>Thị trường <b>{info.market_regime ?? '—'}</b></span><span>Quy mô <b>{((info.size_multiplier ?? 1) * 100).toLocaleString('vi-VN')}% lệnh chuẩn</b></span></div>
          <p>{funnelResult(row)}. Mua thăm dò là tín hiệu nghiên cứu, không tự ghi lệnh vào danh mục.</p><MonthlyTrendEvidence value={info.monthly}/>
          <details><summary>Mã lý do kỹ thuật</summary><p>{[...row.reasons, ...(info.funnel_reasons ?? [])].join(' · ')}</p><small>Setup: {info.setup_id ?? '—'}</small></details>
        </div>}</td></tr></Fragment>
      })}
    </tbody></table>{!rows.length && <p>{all.length ? 'Không có mã khớp nhóm và bộ lọc hiện tại. Chọn Tất cả để xem toàn bộ đánh giá.' : `Phiên ${dateText(date)} chưa có dữ liệu phễu Challenger.`}</p>}
      <ResearchPagination label="Phân trang phễu Challenger" page={current} pageSize={pageSize} total={rows.length} onPage={value => { setPage(value); setOpened(null) }} onPageSize={size => { setPageSize(size); setPage(1); setOpened(null) }}/></>}
  </article>
}
