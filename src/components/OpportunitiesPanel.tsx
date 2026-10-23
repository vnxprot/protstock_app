import { CardHeader, CardDetailsButton } from './CardHeader'
import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown, SlidersHorizontal, Star } from 'lucide-react'
import { DateField } from './DateField'
import { FilterField } from './FilterField'
import { SoftSelect } from './SoftSelect'
import type { OpenAnalysisDetails } from './AnalysisDetails'
import { useOpportunities, useOpportunityRoute, opportunityHref, opportunityStatus, hasOpportunityPublication, type Opportunity } from '../lib/opportunities'
import { formatDate } from '../lib/date'
import { isWatchActive, toggleWatchlistSymbol, useWatchlist } from '../lib/watchlist'
import './opportunities.css'

const price = (value: number | null | undefined) => value == null ? 'Chưa xác nhận' : (value * 1000).toLocaleString('vi-VN', { maximumFractionDigits: 0 })
const pending: Record<string, string> = { WAIT_EOD: 'Đang chờ dữ liệu EOD được công bố.', PROCESSING: 'Đang xử lý danh sách cơ hội.', NOT_STARTED: 'EOD đã sẵn sàng; bước tổng hợp cơ hội chưa bắt đầu.', FAILED: 'Tổng hợp cơ hội đã thất bại.', STALLED: 'Lượt tổng hợp đã quá thời gian xử lý.', NOT_FOUND: 'Không tìm thấy bản lưu của phiên được chọn.' }
const familyNames: Record<string,string> = { RECOVERY: 'Hồi phục', CONTINUATION: 'Setup / tiếp diễn', UNUSUAL_VOLUME: 'Giao dịch bất thường' }

export function OpportunityEvidence({ row, day }: { row: Opportunity; day?: string }) {
  return <div className="opportunity-evidence"><div><h4>Vì sao đáng chú ý?</h4>{row.reasons.map(reason => <p key={reason}>{reason}</p>)}<small>Phát hiện từ {formatDate(row.first_seen)} · {row.age_sessions} phiên theo dõi</small></div>
    <div><h4>Điều kiện và rủi ro</h4>{row.risks.map(risk => <p key={risk}>{risk}</p>)}<p>{row.next_step}</p></div>
    <dl><div><dt>Giá kích hoạt hệ thống</dt><dd>{price(row.trigger_price)}</dd></div><div><dt>Stop hệ thống</dt><dd>{price(row.invalidation_price)}</dd></div><div><dt>Đáy 10 phiên tham chiếu</dt><dd>{price(row.support_reference)}</dd></div><div><dt>Đỉnh 20 phiên trước</dt><dd>{price(row.resistance_reference)}</dd></div></dl>
    <div><h4>Bằng chứng cùng phiên</h4><p>RSI {row.evidence.rsi14?.toFixed(1) ?? '—'} · KL/TB20 {row.evidence.volume_ratio20?.toFixed(2) ?? '—'}× · Tháng {row.monthly_state}</p>
      {row.evidence.events?.map(event => <p key={event.id}>{event.start_time}–{event.end_time} · {(event.value_vnd / 1e9).toFixed(2)} tỷ · {event.volume.toLocaleString('vi-VN')} CP · giá {event.price_change_pct > 0 ? '+' : ''}{event.price_change_pct.toFixed(2)}% {day&&<a href={`#screener?section=research&tab=spikes&date=${day}&symbol=${row.symbol}&event=${event.id}`}>Xem nến phút</a>}</p>)}
      {!row.evidence.minute_complete && <p>Chưa đủ bằng chứng nến phút cho mã này.</p>}<small>Vùng tham chiếu không phải điểm mua/cắt lỗ đã xác nhận. Cụm tăng không xác định bên mua ròng.</small></div></div>
}

export function OpportunitiesPanel({ compact = false, authenticated = true }: { compact?: boolean; authenticated?: boolean }) {
  const route = useOpportunityRoute()
  const [day, setDay] = useState(compact ? '' : route.date)
  const [publication, setPublication] = useState(compact ? '' : route.publication)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('ALL')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [limit, setLimit] = useState(25)
  const [filtersOpen, setFiltersOpen] = useState(true)
  useEffect(() => { if (!compact) { setDay(route.date); setPublication(route.publication); setExpanded(null) } }, [route.date, route.publication, compact])
  const result = useOpportunities(day, publication, authenticated)
  const watched = useWatchlist().filter(isWatchActive)
  const names = new Set(watched.map(item => item.symbol))
  const data = result.data
  const published = hasOpportunityPublication(data)
  const counts = Object.fromEntries(Object.keys(opportunityStatus).map(status => [status, (data?.rows ?? []).filter(row => row.status === status).length]))
  const buildProblem = data?.build && ['FAILED','STALLED','PARTIAL'].includes(data.build.status)
  const rows = useMemo(() => (data?.rows ?? []).filter(row => (!query || row.symbol.includes(query.trim().toUpperCase()))
    && (filter === 'ALL' || filter === 'WATCHLIST' && names.has(row.symbol) || filter === 'ACTIVE' && ['PRIORITY', 'OBSERVE'].includes(row.status) || row.status === filter)), [data, query, filter, watched.map(item => item.symbol).join(',')])
  const visible = rows.slice(0, compact ? 5 : limit)
  const fullLink = '#screener?section=opportunities' + (data?.trading_date ? '&date=' + data.trading_date : '') + (data?.id ? '&publication=' + data.id : '')
  return <article className={`panel opportunities-panel${compact ? ' opportunities-compact' : ''}`}>
    <div className="panel-title"><div><h2>{compact ? 'Ưu tiên phiên tới' : 'Cơ hội phiên tới'}</h2><p className="muted">Danh sách nghiên cứu cho phiên giao dịch kế tiếp · tách riêng với quyết định mua/bán.</p></div>{compact && <a href={fullLink}>Xem tất cả <ArrowUpRight size={15}/></a>}</div>
    {!compact && <><div className="opportunity-toolbar">
      <div className="opportunity-search"><FilterField label="Tìm mã"><input type="search" aria-label="Tìm mã cơ hội phiên tới" value={query} placeholder="Tìm mã…" onChange={event => { setQuery(event.target.value); setLimit(25) }}/></FilterField></div>
      {filtersOpen && <div id="opportunity-filters" className="opportunity-filter-fields">
        <FilterField label="Hiển thị"><SoftSelect aria-label="Lọc trạng thái cơ hội" value={filter} onChange={event => { setFilter(event.target.value); setLimit(25) }}><option value="ACTIVE">Đang theo dõi</option><option value="PRIORITY">Ưu tiên theo dõi</option><option value="OBSERVE">Theo dõi thêm</option><option value="EXTENDED">Đã kéo xa</option><option value="RISK">Rủi ro hệ thống</option><option value="INVALIDATED">Mất hiệu lực</option><option value="WATCHLIST">Trong Watchlist</option><option value="ALL">Tất cả</option></SoftSelect></FilterField>
        <DateField label="Phiên dữ liệu" value={day || data?.trading_date || ''} onChange={value => { setDay(value); setPublication(''); setLimit(25) }}/>
      </div>}
      <button type="button" className="secondary-button opportunity-filter-toggle" aria-expanded={filtersOpen} aria-controls="opportunity-filters" onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={15}/>Bộ lọc{filter !== 'ALL' || day ? ` · ${Number(filter !== 'ALL') + Number(Boolean(day))}` : ''}</button>
    </div><button type="button" className="text-button opportunity-latest" onClick={() => { location.hash = 'screener?section=opportunities'; setDay(''); setPublication('') }}>Phiên mới nhất</button></>}
    {result.isLoading && <p role="status">Đang tải danh sách phiên tới…</p>}
    {result.isError && <p role="alert">Chưa tải được danh sách cơ hội. <button type="button" className="text-button" onClick={() => void result.refetch()}>Thử lại</button></p>}
    {data && !published && <p role={data.status==='FAILED'||data.status==='STALLED'?'alert':'status'}>{pending[data.status] ?? 'Danh sách chưa được công bố.'} · Phiên {formatDate(data.trading_date)}. Chưa thể kết luận không có cơ hội.</p>}
    {buildProblem && <p className="opportunity-build-error" role="alert">{data?.build?.last_error || 'Bước tổng hợp cần phục hồi.'} · {data?.build?.phase==='EOD'?'EOD sơ bộ':'Đối chiếu Radar'} · Lượt {data?.build?.attempt}/3{data?.build?.finished_at?' · '+new Date(data.build.finished_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):''}. {data?.build?.retry_exhausted?'Đã hết lượt tự phục hồi cho nguồn này; cần xử lý lỗi.':'Hệ thống sẽ thử lại theo lịch phục hồi.'}</p>}
    {published && <>
      {data.status==='PROVISIONAL'&&<p className="opportunity-phase" role="status">Danh sách EOD sơ bộ · {data.summary?.input_complete===false?'Một số nhóm mã chưa xử lý xong.':'Chưa đối chiếu đầy đủ Radar.'} Chưa gửi bản tin Telegram hoàn chỉnh.</p>}
      {data.status==='STALE'&&<p className="opportunity-phase" role="status">Bản công bố trước đang được giữ để tham khảo; nguồn dữ liệu đã thay đổi, cần tổng hợp lại.</p>}
      <div className="opportunity-counts" role="group" aria-label="Số mã theo trạng thái">{Object.entries(opportunityStatus).map(([status,label])=><button type="button" key={status} onClick={()=>setFilter(status)} aria-pressed={filter===status}>{label} <b>{counts[status]}</b></button>)}<button type="button" onClick={()=>setFilter('ALL')} aria-pressed={filter==='ALL'}>Tất cả <b>{data.rows.length}</b></button></div><p className="opportunity-date">Dữ liệu {formatDate(data.trading_date)} · Công bố {data.published_at ? new Date(data.published_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—'} · Xử lý {data.summary?.processed_symbols ?? '—'}/{data.summary?.expected_symbols ?? '—'} mã · Radar {data.summary?.radar_coverage ?? '—'}{data.pinned ? ' · Bản lưu cố định' : ''}{data.historical ? ' · Tái dựng từ dữ liệu lưu trữ' : ''}</p>
      {!visible.length && <p>Không có mã đạt bộ lọc hiện tại trong phiên đã công bố.</p>}
      <div className="opportunity-list">{visible.map(row => <section className={`opportunity-row status-${row.status.toLowerCase()}`} key={row.symbol_id}>
        <div className="opportunity-line"><div className="opportunity-name"><span className="opportunity-rank">#{row.rank}</span><a href={opportunityHref(row.symbol, data.trading_date, data.id)}><strong>{row.symbol}</strong></a><small>{row.sector}</small></div>
          <div className="opportunity-reason"><b>{opportunityStatus[row.status]}</b><span>{row.reasons[0]}</span>{row.reasons[1] && <small>{row.reasons[1]}</small>}</div>
          <div className="opportunity-decision"><small>{row.families?.map(value=>familyNames[value]).join(' · ')}</small><span>Hệ thống {row.system_action}</span><small>{row.risks[0] ?? 'Kiểm tra điều kiện phiên kế tiếp'}</small></div>
          <div className="opportunity-actions"><button type="button" className="icon-button" aria-label={`${names.has(row.symbol) ? 'Bỏ' : 'Thêm'} ${row.symbol} ${names.has(row.symbol) ? 'khỏi' : 'vào'} Watchlist`} onClick={() => toggleWatchlistSymbol(row.symbol)}><Star size={16} fill={names.has(row.symbol) ? 'currentColor' : 'none'}/></button><CardDetailsButton context={row.symbol} aria-expanded={expanded === row.symbol_id} onClick={() => setExpanded(expanded === row.symbol_id ? null : row.symbol_id)}/></div></div>
        {expanded === row.symbol_id && <OpportunityEvidence row={row} day={data.trading_date}/>}</section>)}</div>
      {!compact && rows.length > visible.length && <button type="button" className="secondary-button" onClick={() => setLimit(value => value + 25)}>Xem thêm · {visible.length}/{rows.length} mã</button>}
      {!compact && data.summary?.diagnostics && <details className="opportunity-diagnostics"><summary>Độ phủ và lý do chưa vào danh sách</summary><p>Thiếu lịch sử: {data.summary.diagnostics.insufficient_history??0} · Giá thiếu/sai phiên: {data.summary.diagnostics.stale_or_invalid_price??0} · Thanh khoản dưới ngưỡng: {data.summary.diagnostics.below_turnover_floor??0} · Chưa có bằng chứng phù hợp: {data.summary.diagnostics.no_matching_evidence??0} · Nhóm mã chưa đọc được: {Math.max(0,(data.summary.expected_symbols??0)-(data.summary.processed_symbols??0))} mã.</p></details>}
      {!compact && <small className="opportunity-note">Thứ hạng thể hiện mức ưu tiên nghiên cứu, chưa phải xác suất thắng. Dữ liệu EOD và nến phút được tổng hợp sau phiên. Phiên theo dõi kết thúc khi mất vùng tham chiếu hoặc sau 5 phiên nếu không có bằng chứng mới.</small>}</>}
  </article>
}

export function OpportunityAnalysis({ symbol, onOpenDetails }: { symbol: string; onOpenDetails?: OpenAnalysisDetails }) {
  const route = useOpportunityRoute()
  const result = useOpportunities(route.date, route.publication)
  const row = result.data?.rows.find(item => item.symbol === symbol)
  if (result.isError) return <article className={onOpenDetails ? "panel quant-card" : "panel"}>{onOpenDetails && <CardHeader title="Chuẩn bị phiên tới"/>}<p>Chưa tải được bằng chứng chuẩn bị phiên tới. <button type="button" className="text-button" onClick={() => void result.refetch()}>Thử lại</button></p></article>
  if ((!row || !hasOpportunityPublication(result.data)) && onOpenDetails) return <article className="panel quant-card"><CardHeader title="Chuẩn bị phiên tới" subtitle={formatDate(result.data?.trading_date)}/><p>{result.isLoading ? 'Đang tải bằng chứng phiên tới…' : hasOpportunityPublication(result.data) ? 'Mã này chưa có cơ hội trong bản công bố được chọn.' : 'Danh sách phiên tới chưa được công bố.'}</p></article>
  if (!row || !hasOpportunityPublication(result.data)) return route.publication ? <article className="panel"><p>Không có bằng chứng cho mã này trong bản lưu được chọn.</p></article> : null
  if (onOpenDetails) return <article className="panel quant-card"><CardHeader title="Chuẩn bị phiên tới" subtitle={<>{result.data.phase === 'EOD' ? 'EOD sơ bộ · ' : ''}{formatDate(result.data.trading_date)} · Hệ thống {row.system_action} · #{row.rank}</>} status={<span className={`quant-status opportunity-${row.status.toLowerCase()}`}>{opportunityStatus[row.status]}</span>} onDetails={() => onOpenDetails(`Chuẩn bị phiên tới · ${opportunityStatus[row.status]}`, <><OpportunityEvidence row={row} day={result.data?.trading_date}/><p className="quant-caption">Bằng chứng nghiên cứu được lưu riêng; biểu đồ giới hạn đến phiên được chọn.</p></>)}/><p className="quant-caption">Phát hiện {formatDate(row.first_seen)} · {row.age_sessions} phiên theo dõi · Tháng {row.monthly_state}</p><p>{row.status === 'EXTENDED' ? 'Giá đã kéo xa. Cần kiểm tra điều kiện và rủi ro trước khi xem xét vị thế.' : row.reasons.slice(0, 2).join(' · ') || row.next_step}</p>{row.status !== 'EXTENDED' && <><p><strong>Điều kiện: </strong>{row.next_step}</p>{!!row.risks.length && <p className="quant-risk-note"><strong>Rủi ro: </strong>{row.risks.slice(0, 2).join(' · ')}</p>}<dl className="quant-flow-grid"><div><dt>Kích hoạt hệ thống</dt><dd>{price(row.trigger_price)}</dd></div><div><dt>Stop hệ thống</dt><dd>{price(row.invalidation_price)}</dd></div></dl></>}</article>
  return <details key={`${symbol}-${result.data.id}-${row.status}`} className="panel opportunities-panel opportunity-analysis" open={row.status === 'EXTENDED' ? undefined : true}><summary><span><strong>Chuẩn bị phiên tới · {opportunityStatus[row.status]}</strong><small>{result.data.phase==='EOD'?'EOD sơ bộ · ':''}Bằng chứng phiên {formatDate(result.data.trading_date)} · Hệ thống {row.system_action} · #{row.rank}</small>{row.status === 'EXTENDED' && <small className="opportunity-extension-warning">Giá đã kéo xa · mở để xem điều kiện và rủi ro.</small>}</span><ChevronDown size={16}/></summary><OpportunityEvidence row={row} day={result.data.trading_date}/><p className="opportunity-note">Bằng chứng nghiên cứu được lưu riêng; biểu đồ giới hạn đến phiên được chọn.</p></details>
}

export function OpportunityBadge({ symbol }: { symbol: string }) {
  const result = useOpportunities()
  const row = hasOpportunityPublication(result.data) ? result.data.rows.find(item => item.symbol === symbol) : undefined
  return row ? <a className={`opportunity-badge status-${row.status.toLowerCase()}`} href={opportunityHref(symbol, result.data?.trading_date, result.data?.id)}>{opportunityStatus[row.status]}{result.data?.phase==='EOD'?' · EOD sơ bộ':''}{result.data?.status==='STALE'?' · chờ cập nhật':''}</a> : null
}
