import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, BookOpenCheck, RefreshCw, Save, Search, Star, X } from 'lucide-react'
import { useSymbols } from '../hooks/useStockAnalysis'
import { useInvestmentModules } from '../hooks/useInvestmentModules'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { supabase } from '../lib/supabase'
import { formatDate, todayInVietnam } from '../lib/date'
import { canslimChecks, cycleLabels, emptyReview, eventLabels, reasonLabels, reviewIsStale, safeSource, setupLabels, statusLabels, technicalFresh, validateReview, type CheckStatus, type ModuleRow, type Review, type ReviewStatus } from '../lib/investmentModules'
import { isWatchActive, toggleWatchlistSymbol, useWatchlist } from '../lib/watchlist'
import '../investment-modules.css'

type Stock = { id: number; symbol: string; sector: string; company_name: string | null; exchange: string; trading_status: string }
type Item = { stock: Stock; row?: ModuleRow; review?: Review; fresh: boolean; checks: Record<string, CheckStatus> }
const number = (value?: number | null, digits = 1) => value == null ? '—' : value.toLocaleString('vi-VN', { maximumFractionDigits: digits })
const pct = (value?: number | null) => value == null ? '—' : `${number(value)}%`
const price = (value?: number | null) => value == null ? '—' : number(value * 1000, 0)
function openAnalysis(symbol: string) { localStorage.setItem('protstock-symbol', symbol); dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol })); location.hash = 'analysis' }

export function InvestmentModulesPage({ module, authenticated, ownerId, canReview = false }: { module: 'canslim' | 'cycle'; authenticated: boolean; ownerId?: string; canReview?: boolean }) {
  const isGrowth = module === 'canslim'
  const symbols = useSymbols(authenticated)
  const data = useInvestmentModules(authenticated, ownerId, canReview)
  const watchlist = useWatchlist().filter(isWatchActive).map(item => item.symbol)
  const [query, setQuery] = useState(''), [sector, setSector] = useState('ALL'), [preset, setPreset] = useState('ALL')
  const [liquidity, setLiquidity] = useState(0), [onlyWatched, setOnlyWatched] = useState(false), [page, setPage] = useState(1)
  const [focused, setFocused] = useState<number | null>(null)
  const items = useMemo(() => {
    const current = new Map(data.data?.current.map(row => [row.symbol_id, row]))
    const reviews = new Map(data.data?.reviews.map(row => [row.symbol_id, row]))
    return (symbols.data ?? []).map(stock => {
      const row = current.get(stock.id), review = reviews.get(stock.id)
      return { stock: stock as Stock, row, review, fresh: technicalFresh(row, data.publication?.date, data.publication?.sourceRevision), checks: canslimChecks(row, review, data.data?.market, data.publication?.date, data.publication?.sourceRevision) }
    })
  }, [symbols.data, data.data, data.publication])
  const filtered = items.filter(item => {
    const e = item.row?.evidence, stock = item.stock
    if (query && !`${stock.symbol} ${stock.company_name ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false
    if (sector !== 'ALL' && stock.sector !== sector || onlyWatched && !watchlist.includes(stock.symbol)) return false
    if (liquidity && (!item.fresh || (e?.liquidity_vnd ?? 0) < liquidity)) return false
    if (preset === 'ALL') return true
    if (isGrowth) {
      if (preset === 'VERIFIED') return item.checks.C === 'PASS' && item.checks.A === 'PASS'
      if (preset === 'RESEARCH') return item.fresh && ['NEAR_PIVOT', 'BREAKOUT'].includes(e?.setup ?? '') && (e?.rs_percentile ?? -1) >= 80 && (item.checks.C !== 'PASS' || item.checks.A !== 'PASS')
      if (preset === 'ALL_CHECKS') return item.fresh && stock.trading_status === 'NORMAL' && (e?.liquidity_vnd ?? 0) >= 1_000_000_000 && Object.values(item.checks).every(value => value === 'PASS')
      if (preset === 'STALE') return Object.values(item.checks).includes('STALE')
      return item.fresh && e?.setup === preset
    }
    return item.fresh && e?.cycle.state === preset || preset === 'UNKNOWN' && !item.fresh
  }).sort((a, b) => Number(b.fresh) - Number(a.fresh) || (b.row?.evidence.rs_percentile ?? -1) - (a.row?.evidence.rs_percentile ?? -1) || a.stock.symbol.localeCompare(b.stock.symbol))
  useEffect(() => setPage(1), [query, sector, preset, liquidity, onlyWatched, module])
  const pageCount = Math.max(1, Math.ceil(filtered.length / 30)), currentPage = Math.min(page, pageCount)
  const selected = items.find(item => item.stock.id === focused)
  const sectors = [...new Set(items.map(item => item.stock.sector))].sort()
  const readyCount = items.filter(item => item.fresh).length
  const error = data.error || data.publicationError || symbols.error
  return <section className="investment-page">
    <header className="dashboard-header"><div><span className="investment-eyebrow">{isGrowth ? 'O’NEIL · NGHIÊN CỨU TĂNG TRƯỞNG' : 'CHU KỲ GIÁ · NGÀY VÀ TUẦN'}</span><h1>{isGrowth ? 'CAN SLIM' : 'Chu kỳ cổ phiếu'}</h1><p>{isGrowth ? 'Quan sát giá tự động, xác minh doanh nghiệp theo tài liệu đã đọc. Bảy tiêu chí được trình bày riêng.' : 'Nhìn trạng thái tuần đã đóng và sự kiện ngày. Tích lũy, tăng giá, phân phối, giảm giá.'}</p></div><button className="secondary-button" onClick={() => { void data.refetch(); void symbols.refetch() }} disabled={data.isFetching}><RefreshCw size={16}/>Cập nhật</button></header>
    <div className="investment-summary"><article className="panel"><span>Ngày công bố EOD</span><strong>{formatDate(data.publication?.date)}</strong><small>{data.publication?.publicationStatus ?? 'Chưa có công bố'}</small></article><article className="panel"><span>Dữ liệu kỹ thuật cùng phiên</span><strong>{readyCount}/{items.length}</strong><small>Mã thiếu hoặc cũ vẫn hiển thị rõ</small></article><article className="panel"><span>{isGrowth ? 'C/A đã xác minh còn hạn' : 'Khung phân loại chính'}</span><strong>{isGrowth ? items.filter(item => item.checks.C === 'PASS' && item.checks.A === 'PASS').length : 'Tuần đã đóng'}</strong><small>{isGrowth ? 'Đánh giá quá 90 ngày cần xem lại' : 'Hai tuần liên tiếp cùng trạng thái để củng cố'}</small></article></div>
    {error && <div className="investment-notice negative" role="alert">Chưa tải được dữ liệu module. Nếu vừa triển khai, chờ tác vụ cài dữ liệu hoàn tất rồi bấm Cập nhật. {error instanceof Error ? error.message : ''}</div>}
    {!error && !data.isLoading && !data.publicationLoading && !readyCount && <p className="investment-notice" role="status">Chưa có dữ liệu kỹ thuật khớp phiên EOD. Tác vụ nền sẽ tính từ giá đã lưu; bảng kiểm Fundamental vẫn có thể dùng.</p>}
    <div className="panel investment-toolbar"><label className="investment-search"><Search size={16}/><input aria-label="Tìm mã hoặc doanh nghiệp" placeholder="Tìm mã hoặc doanh nghiệp…" value={query} onChange={e => setQuery(e.target.value)}/></label><label>Ngành<select value={sector} onChange={e => setSector(e.target.value)}><option value="ALL">Tất cả ngành</option>{sectors.map(value => <option key={value}>{value}</option>)}</select></label><label>Thanh khoản trung vị 20 phiên<select value={liquidity} onChange={e => setLiquidity(Number(e.target.value))}><option value={0}>Không giới hạn</option><option value={1e9}>Từ 1 tỷ/phiên</option><option value={5e9}>Từ 5 tỷ/phiên</option><option value={10e9}>Từ 10 tỷ/phiên</option></select></label><label className="investment-checkbox"><input type="checkbox" checked={onlyWatched} onChange={e => setOnlyWatched(e.target.checked)}/>Watchlist</label></div>
    <div className="investment-presets" aria-label="Danh sách lọc">{(isGrowth ? [['ALL', 'Tất cả'], ['RESEARCH', 'Cần đọc Fundamental'], ['VERIFIED', 'C/A đã xác minh'], ['NEAR_PIVOT', 'Sắp vượt nền'], ['BREAKOUT', 'Vượt nền'], ['PULLBACK', 'Điều chỉnh'], ['EXTENDED', 'Đã kéo xa'], ['STALE', 'Cần xem lại'], ['ALL_CHECKS', 'Đủ 7 tiêu chí tham chiếu']] : [['ALL', 'Tất cả'], ...Object.entries(cycleLabels)]).map(([value, label]) => <button className={preset === value ? 'active' : ''} key={value} onClick={() => setPreset(value)} aria-pressed={preset === value}>{label}</button>)}</div>
    <div className="panel investment-table-wrap"><table className="investment-table"><thead><tr><th>Mã / Ngành</th>{isGrowth ? <><th>Bảng kiểm CAN SLIM</th><th>Trạng thái giá</th><th>RS Prot</th><th>Đến pivot</th></> : <><th>Trạng thái tuần</th><th>Bằng chứng / Chuyển tiếp</th><th>Sự kiện ngày</th><th>Tuần đóng</th></>}<th>Thanh khoản</th><th aria-label="Thao tác"/></tr></thead><tbody>{filtered.slice((currentPage - 1) * 30, currentPage * 30).map(item => {
      const e = item.row?.evidence, c = e?.cycle
      return <tr key={item.stock.id}><td><button className="investment-symbol" onClick={() => setFocused(item.stock.id)}>{item.stock.symbol}</button><small>{item.stock.sector} · {item.stock.exchange}</small>{item.stock.trading_status !== 'NORMAL' && <small className="negative">{item.stock.trading_status}</small>}</td>{isGrowth ? <><td><Checks checks={item.checks}/></td><td>{item.fresh ? setupLabels[e?.setup ?? ''] ?? 'Quan sát' : 'Dữ liệu chưa sẵn sàng'}</td><td>{item.fresh ? number(e?.rs_percentile) : '—'}<small>{item.fresh && e?.rs_percentile != null ? `Trong ${e.rs_universe_size} mã đủ lịch sử` : 'Cần 253 phiên và ≥20 mã'}</small></td><td>{item.fresh ? pct(e?.distance_pct) : '—'}</td></> : <><td><span className={`investment-stage ${item.fresh ? c?.state.toLowerCase() : 'unknown'}`}>{cycleLabels[item.fresh ? c?.state ?? 'UNKNOWN' : 'UNKNOWN']}</span></td><td>{item.fresh && c?.state === 'TRANSITION' ? `Nghiêng ${cycleLabels[c.candidate].toLowerCase()}` : item.fresh && c?.evidence_level === 'SUPPORTED' ? 'Hai tuần đồng thuận' : 'Chưa đủ bằng chứng'}</td><td>{item.fresh && c?.daily_event ? eventLabels[c.daily_event] : '—'}</td><td>{item.fresh ? formatDate(c?.weekly_date) : '—'}</td></>}<td>{item.fresh && e?.liquidity_vnd != null ? `${number(e.liquidity_vnd / 1e9)} tỷ` : '—'}<small>{item.row ? formatDate(item.row.as_of_date) : 'Chưa tính'}</small></td><td><button className={watchlist.includes(item.stock.symbol) ? 'icon-button positive' : 'icon-button'} aria-label={`Theo dõi ${item.stock.symbol}`} onClick={() => toggleWatchlistSymbol(item.stock.symbol)}><Star size={16} fill={watchlist.includes(item.stock.symbol) ? 'currentColor' : 'none'}/></button><button className="text-button" onClick={() => setFocused(item.stock.id)}>Chi tiết</button></td></tr>
    })}</tbody></table>{!filtered.length && <p className="investment-empty">{data.isLoading || symbols.isLoading ? 'Đang tải…' : 'Không có mã phù hợp bộ lọc.'}</p>}</div>
    <div className="investment-pagination"><span>{filtered.length} mã · Trang {currentPage}/{pageCount}</span><button className="secondary-button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trước</button><button className="secondary-button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Sau</button></div>
    <details className="panel investment-method"><summary>Cách đọc và giới hạn</summary>{isGrowth ? <><p>C/A/N/I do người dùng xác minh. S chỉ xác nhận biểu hiện cầu ở phiên vượt vùng giá 50 phiên có volume ≥1,5 lần trung bình 50 phiên trước; trạng thái khác không tự coi là không đạt. L là phân vị lợi suất 252 phiên trong universe đủ dữ liệu, ưu tiên ≥80; đây là xếp hạng Prot, khác RS Rating của IBD và khác RSI. M cần độ phủ thị trường đầy đủ, xu hướng lên và Market Health tích cực.</p><p>Pivot là đỉnh vùng 50 phiên, độ rộng nền tham chiếu 5–30%; đây là vùng quan sát, chưa xác nhận đầy đủ cup-with-handle hoặc VCP. Thanh khoản là trung vị giá đóng × khối lượng 20 phiên. Danh sách đủ 7 tiêu chí còn yêu cầu giao dịch bình thường và thanh khoản ≥1 tỷ/phiên; không tạo lệnh mua tự động.</p><p>C tham chiếu EPS và doanh thu quý tăng ≥25% cùng kỳ; A tham chiếu tăng EPS từng năm trong 3 năm ≥25%, ROE ≥17%. N cần động lực kinh doanh, I cần bằng chứng tổ chức; mua ròng nước ngoài không tự đại diện I. <a href="https://shop.investors.com/images/promotional/20-Rules_102808.pdf" target="_blank" rel="noreferrer">Tài liệu IBD</a></p></> : <><p>MA30 tuần và độ dốc 4 tuần hỗ trợ định lượng: tăng/giảm khi giá trên/dưới MA tương ứng, độ dốc vượt ±1%, hiệu suất 8 tuần vượt ±3%. Vùng 8 tuần rộng ≤35%, MA tương đối phẳng (±3%) và diễn biến 12 tuần trước đó vượt ±12% tạo giả thuyết tích lũy/phân phối. Đây là tham số Prot, không phải định nghĩa trọn vẹn Wyckoff.</p><p>Chỉ dùng tuần đã đóng; trạng thái mới cần hai tuần đồng thuận. Vùng đi ngang chưa chứng minh tổ chức tích lũy/phân phối. Có thể tái tích lũy, tái phân phối và chuyển pha thất bại; không ép chu kỳ tuần tự. Spring/SOS/UTAD/SOW là bằng chứng ngày độc lập. <a href="https://www.wyckoffanalytics.com/wyckoff-method/" target="_blank" rel="noreferrer">Tài liệu Wyckoff</a></p></>}<p>Hai module hoạt động độc lập, dùng cùng giá chuẩn của hệ thống. Mức bằng chứng không phải xác suất sinh lời. Không chạy backtest hay thay đổi tín hiệu mua/bán hiện có.</p></details>
    {selected && <ModuleDetail key={`${module}:${selected.stock.id}`} item={selected} module={module} ownerId={ownerId} canReview={canReview && !data.isError && !data.isLoading} onClose={() => setFocused(null)} onSaved={() => { void data.refetch() }}/>}
  </section>
}

function Checks({ checks }: { checks: Record<string, CheckStatus> }) { return <div className="investment-checks">{Object.entries(checks).map(([letter, status]) => <span key={letter} className={`investment-check ${status.toLowerCase()}`} title={`${letter}: ${statusLabels[status]}`} aria-label={`${letter}: ${statusLabels[status]}`}>{letter}<small>{status === 'PASS' ? '✓' : status === 'FAIL' ? '×' : status === 'STALE' ? '↻' : '?'}</small></span>)}</div> }

function ModuleDetail({ item, module, ownerId, canReview, onClose, onSaved }: { item: Item; module: 'canslim' | 'cycle'; ownerId?: string; canReview: boolean; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLElement>(null), close = useCallback(onClose, [onClose])
  useDialogFocus(true, ref, close)
  const e = item.fresh ? item.row?.evidence : undefined, c = e?.cycle
  const history = useQuery({ queryKey: ['investment-events', item.stock.id, item.row?.as_of_date], enabled: module === 'cycle' && Boolean(supabase), queryFn: async () => { const { data, error } = await supabase!.from('investment_module_events').select('observed_on,stage,candidate,setup,weekly_date').eq('symbol_id', item.stock.id).order('observed_on', { ascending: false }).limit(12); if (error) throw error; return data ?? [] } })
  return <div className="sheet-backdrop" onMouseDown={onClose}><article ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="investment-detail-title" className="investment-detail panel" onMouseDown={event => event.stopPropagation()}><header><div><h2 id="investment-detail-title">{item.stock.symbol} · {module === 'canslim' ? 'CAN SLIM' : 'Chu kỳ'}</h2><p>{item.stock.company_name}</p></div><button className="icon-button" aria-label="Đóng chi tiết" onClick={onClose}><X size={20}/></button></header>
    <button className="text-button" onClick={() => openAnalysis(item.stock.symbol)}>Mở phân tích và biểu đồ <ArrowUpRight size={15}/></button>
    {!item.fresh && <p className="investment-notice">Dữ liệu kỹ thuật chưa khớp phiên công bố hoặc chưa đủ lịch sử; các con số cũ không dùng để lọc ứng viên.</p>}
    {item.fresh && e && <><div className="investment-detail-grid"><div>Giá đóng cửa<strong>{price(e.close)} đ</strong></div><div>RS Prot 12 tháng<strong>{number(e.rs_percentile)} / 100</strong></div><div>Vùng cản 50 phiên<strong>{price(e.pivot)} đ</strong></div><div>Đến vùng cản<strong>{pct(e.distance_pct)}</strong></div><div>Volume / TB50 trước phiên<strong>{number(e.volume_ratio50, 2)}×</strong></div><div>Cách đỉnh 52 tuần<strong>{pct(e.high52_distance_pct)}</strong></div></div><p>Vượt VN-Index trên cùng hai ngày đầu/cuối: 3 tháng {pct(e.rs3m_excess)} · 6 tháng {pct(e.rs6m_excess)} · 12 tháng {pct(e.rs12m_excess)}.</p><small>Nguồn {e.source ?? '—'} · EOD {formatDate(item.row?.as_of_date)} · Giá quy đổi VND/cổ phiếu</small></>}
    {module === 'canslim' ? <><h3>Bảy tiêu chí, bảy bằng chứng</h3><Checks checks={item.checks}/><p>C/A/N/I là xác minh cá nhân; S/L/M là điều kiện kỹ thuật tham chiếu. “?” là chưa đủ căn cứ, không được tính thành đạt.</p>{canReview && ownerId ? <ReviewEditor initial={item.review ?? emptyReview(item.stock.id)} ownerId={ownerId} onSaved={onSaved}/> : item.review ? <p>Đã đọc {item.review.reporting_period} ngày {formatDate(item.review.reviewed_on)}.</p> : <p>Chưa có xác minh Fundamental. Tài khoản quản trị có thể lưu bảng kiểm sau khi đọc tài liệu bên ngoài.</p>}</> : <><h3>{cycleLabels[item.fresh ? c?.state ?? 'UNKNOWN' : 'UNKNOWN']}</h3><p>{reasonLabels[c?.reason ?? ''] ?? 'Chưa có đủ bằng chứng.'}</p>{c?.state === 'TRANSITION' && <p>Đang nghiêng về {cycleLabels[c.candidate].toLowerCase()}; chờ thêm tuần đã đóng để củng cố.</p>}<p>Tuần đánh giá: {formatDate(c?.weekly_date)} · {c?.closed_weeks ?? 0} tuần đã đóng. Biên tuần: {price(c?.support)} – {price(c?.resistance)} đ. MA30 tuần: {price(c?.ma30)} đ; độ dốc 4 tuần {pct(c?.slope4_pct)}.</p><p>{c?.invalidation === 'BELOW_RANGE_SUPPORT' ? 'Mất biên hỗ trợ tuần sẽ làm nhận định tích cực yếu đi; cần đánh giá lại.' : c?.invalidation === 'ABOVE_RANGE_RESISTANCE' ? 'Vượt lại biên kháng cự tuần sẽ làm nhận định tiêu cực yếu đi; cần đánh giá lại.' : 'Chưa đủ cơ sở đặt điều kiện vô hiệu cụ thể.'}</p><p>Sự kiện ngày: {c?.daily_event ? eventLabels[c.daily_event] : 'Chưa có sự kiện xác nhận mới'}.</p><h3>Lịch sử phát hiện thay đổi</h3>{history.isError ? <p role="alert">Chưa tải được lịch sử chuyển trạng thái.</p> : !history.data?.length ? <p>Chưa có lịch sử quan sát; hệ thống không dựng lại ngày phát hiện trong quá khứ.</p> : <ul>{history.data.map(row => <li key={row.observed_on}>{formatDate(row.observed_on)} · {cycleLabels[row.stage as keyof typeof cycleLabels] ?? row.stage} · {setupLabels[row.setup] ?? row.setup}</li>)}</ul>}</>}
  </article></div>
}

function ReviewEditor({ initial, ownerId, onSaved }: { initial: Review; ownerId: string; onSaved: () => void }) {
  const key = `protstock-canslim-draft:${ownerId}:${initial.symbol_id}`
  const [draft, setDraft] = useState<Review>(() => { try { const saved = localStorage.getItem(key); if (saved) { const parsed = JSON.parse(saved) as Review; if (parsed.symbol_id === initial.symbol_id && typeof parsed.revision === 'number') return parsed } } catch { /* Cloud review remains available if device storage fails. */ } return initial })
  const [message, setMessage] = useState(''), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(() => { try { return Boolean(localStorage.getItem(key)) } catch { return false } })
  const [storageError, setStorageError] = useState(false)
  useEffect(() => { if (!dirty) return; try { localStorage.setItem(key, JSON.stringify(draft)); setStorageError(false) } catch { setStorageError(true) } }, [draft, dirty, key])
  function patch(value: Partial<Review>) { setDirty(true); setDraft(old => ({ ...old, ...value })); setMessage('') }
  async function save() {
    const error = validateReview(draft)
    if (error) { setMessage(error); return }
    setSaving(true)
    try {
      const { data, error: saveError } = await supabase!.rpc('save_canslim_review', { p_symbol_id: initial.symbol_id, p_review: draft, p_expected_revision: draft.revision, p_expected_user_id: ownerId })
      if (saveError) throw saveError
      setDraft(data as Review); setDirty(false)
      try { localStorage.removeItem(key) } catch { /* Saved cloud copy is authoritative. */ }
      setMessage('Đã lưu vào tài khoản.'); onSaved()
    } catch (error) { onSaved(); setMessage(`Chưa lưu được; bản đang sửa vẫn được giữ trên thiết bị nếu bộ nhớ khả dụng. ${error instanceof Error ? error.message : String((error as { message?: string }).message ?? '')}`) }
    finally { setSaving(false) }
  }
  const source = safeSource(draft.source_url)
  return <form className="investment-review" onSubmit={event => { event.preventDefault(); void save() }}>
    <h3><BookOpenCheck size={17}/> Xác minh Fundamental</h3><p>Đọc tài liệu bên ngoài rồi lưu kết luận. C: EPS/doanh thu quý; A: lịch sử EPS/ROE; N: động lực mới; I: sở hữu tổ chức.</p>
    {reviewIsStale(draft) && <p className="investment-notice">Đánh giá đã cũ hoặc ngày chưa hợp lệ. Cần đọc lại và cập nhật ngày xác minh.</p>}
    <div className="investment-review-status">{(['c', 'a', 'n', 'i'] as const).map(letter => <label key={letter}>{letter.toUpperCase()}<select value={draft[letter]} disabled={saving} onChange={event => patch({ [letter]: event.target.value as ReviewStatus })}>{(['UNKNOWN', 'PASS', 'FAIL'] as const).map(status => <option value={status} key={status}>{statusLabels[status]}</option>)}</select></label>)}</div>
    <label>Ngày thực sự đọc và xác minh<input type="date" required max={todayInVietnam()} value={draft.reviewed_on} disabled={saving} onChange={e => patch({ reviewed_on: e.target.value })}/></label>
    <label>Kỳ báo cáo đã đọc<input maxLength={80} placeholder="Ví dụ: Q2/2026 hợp nhất; năm 2023–2025" value={draft.reporting_period} disabled={saving} onChange={e => patch({ reporting_period: e.target.value })}/></label>
    <label>Động lực tăng trưởng mới<textarea maxLength={600} rows={3} value={draft.catalyst} disabled={saving} onChange={e => patch({ catalyst: e.target.value })}/></label>
    <label>Rủi ro / Điều cần kiểm chứng<textarea maxLength={1200} rows={4} value={draft.risks} disabled={saving} onChange={e => patch({ risks: e.target.value })}/></label>
    <label>Liên kết nguồn<input type="url" maxLength={1000} placeholder="https://…" value={draft.source_url} disabled={saving} onChange={e => patch({ source_url: e.target.value })}/></label>{source && <a href={source} target="_blank" rel="noreferrer">Mở nguồn đã ghi <ArrowUpRight size={14}/></a>}
    {dirty && <p role="status">{storageError ? 'Bộ nhớ thiết bị không khả dụng; giữ trang mở đến khi lưu thành công.' : 'Có bản sửa được giữ trên thiết bị, chưa lưu vào tài khoản.'}</p>}
    {message && <p role="status">{message}</p>}
    <div className="investment-review-actions"><button type="submit" className="primary-button" disabled={saving || !dirty}><Save size={16}/>{saving ? 'Đang lưu…' : 'Lưu xác minh'}</button><button className="secondary-button" type="button" disabled={saving} onClick={() => { setDraft(initial); setDirty(false); try { localStorage.removeItem(key) } catch { /* Device storage unavailable. */ } setMessage('Đã dùng lại bản đang lưu trên tài khoản.') }}>Dùng bản trên tài khoản</button></div>
  </form>
}
