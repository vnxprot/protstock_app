import { useEffect, useState } from 'react'
import { Filter, Search, SlidersHorizontal } from 'lucide-react'
import { DateField } from './DateField'
import { FilterField } from './FilterField'
import { SoftSelect } from './SoftSelect'
import { cycleLabels, eventLabels, setupLabels, statusLabels } from '../lib/investmentModules'
import { emptyInvestmentFilters, investmentRange, type InvestmentFilters } from '../lib/investmentFilters'
import { signalHistoryRanges, type SignalHistoryRange } from '../lib/signalHistoryRange'
import { formatDate } from '../lib/date'

type Props = { filters: InvestmentFilters; onChange: (filters: InvestmentFilters) => void; isGrowth: boolean; sectors: string[]; exchanges: string[]; tradingStatuses: string[]; latestDate: string | null; focus: { key: string; serial: number } | null }
export function InvestmentFilterControls({ filters: f, onChange, isGrowth, sectors, exchanges, tradingStatuses, latestDate, focus }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [range, setRange] = useState<SignalHistoryRange>('ALL')
  const patch = (value: Partial<InvestmentFilters>) => onChange({ ...f, ...value })
  useEffect(() => { if (focus) setAdvancedOpen(true) }, [focus])
  useEffect(() => {
    if (!advancedOpen || !focus) return
    const id = requestAnimationFrame(() => {
      const group = document.getElementById(`investment-filter-${focus.key}`)
      group?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      group?.querySelector<HTMLElement>('input:not([type=date]),button[role=combobox]')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [advancedOpen, focus])
  const select = (key: keyof InvestmentFilters, label: string, choices: [string, string][]) => <div id={`investment-filter-${key}`}><FilterField label={label}><SoftSelect aria-label={label} value={String(f[key])} onChange={event => patch({ [key]: event.target.value })}><option value="ALL">Tất cả</option>{choices.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</SoftSelect></FilterField></div>
  const numeric = (key: 'rsMin' | 'rsMax' | 'pivotMin' | 'pivotMax' | 'liquidityMin' | 'liquidityMax', label: string, min?: number, max?: number) => <div id={`investment-filter-${key}`}><FilterField label={label}><input type="number" step="any" min={min} max={max} aria-label={label} value={f[key]} placeholder="Không giới hạn" onChange={event => patch({ [key]: event.target.value })}/></FilterField></div>
  return <>
    <div className="screener-filter-toolbar investment-filter-toolbar">
      <div className="screener-filter-fields">
        <label className="screener-field screener-search"><Search size={15}/><input aria-label="Tìm mã hoặc doanh nghiệp" placeholder="Tìm mã…" value={f.query} onChange={event => patch({ query: event.target.value })}/></label>
        <label className="screener-field"><Filter size={15}/><SoftSelect aria-label="Lọc ngành" value={f.sector} onChange={event => patch({ sector: event.target.value })}><option value="ALL">Tất cả ngành</option>{sectors.map(value => <option key={value}>{value}</option>)}</SoftSelect></label>
      </div>
      <div className="screener-toolbar-actions"><button type="button" className={advancedOpen ? 'advanced-toggle active' : 'advanced-toggle'} aria-expanded={advancedOpen} aria-controls="investment-advanced" onClick={() => setAdvancedOpen(value => !value)}><SlidersHorizontal size={15}/>Bộ lọc nâng cao</button></div>
      <div className="screener-toolbar-scope"><span>{f.dateBasis === 'weekly_date' ? 'Lọc theo ngày đóng tuần' : f.dateBasis === 'reviewed_on' ? 'Lọc theo ngày xác minh Fundamental' : 'Lọc theo ngày cập nhật EOD'} · Bản hiện tại đến <b>{formatDate(latestDate)}</b></span></div>
    </div>
    {advancedOpen && <div id="investment-advanced" className="signal-search-advanced investment-advanced">
      <div id="investment-filter-query"><FilterField label="Mã / Doanh nghiệp"><input aria-label="Lọc cột mã" value={f.query} placeholder="Mã hoặc tên doanh nghiệp" onChange={event => patch({ query: event.target.value })}/></FilterField></div>
      {select('sector', 'Ngành', sectors.map(value => [value, value]))}
      {select('exchange', 'Sàn giao dịch', exchanges.map(value => [value, value]))}
      {select('tradingStatus', 'Trạng thái giao dịch', tradingStatuses.map(value => [value, value]))}
      {select('watch', 'Theo dõi', [['WATCHED', 'Có trong Watchlist'], ['UNWATCHED', 'Chưa trong Watchlist']])}
      {isGrowth ? <>
        {Object.keys({ C: 1, A: 1, N: 1, S: 1, L: 1, I: 1, M: 1 }).map(letter => <div key={letter} id={`investment-filter-check-${letter}`}><FilterField label={`Tiêu chí ${letter}`}><SoftSelect aria-label={`Lọc tiêu chí ${letter}`} value={f.checks[letter] ?? 'ALL'} onChange={event => patch({ checks: { ...f.checks, [letter]: event.target.value } })}><option value="ALL">Tất cả</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SoftSelect></FilterField></div>)}
        {select('setup', 'Trạng thái giá', Object.entries(setupLabels))}
        {numeric('rsMin', 'RS Prot từ', 0, 100)}{numeric('rsMax', 'RS Prot đến', 0, 100)}
        {numeric('pivotMin', 'Đến pivot từ (%)')}{numeric('pivotMax', 'Đến pivot đến (%)')}
      </> : <>
        {select('stage', 'Trạng thái tuần', Object.entries(cycleLabels))}
        {select('evidence', 'Mức bằng chứng', [['SUPPORTED', 'Hai tuần đồng thuận'], ['TENTATIVE', 'Đang chuyển tiếp'], ['INSUFFICIENT', 'Chưa đủ bằng chứng']])}
        {select('event', 'Sự kiện ngày', [['NONE', 'Chưa có sự kiện'], ...Object.entries(eventLabels)])}
      </>}
      {numeric('liquidityMin', 'Thanh khoản TV20 từ (tỷ)', 0)}{numeric('liquidityMax', 'Thanh khoản TV20 đến (tỷ)', 0)}
      <div id="investment-filter-dateBasis"><FilterField label="Mốc thời gian"><SoftSelect aria-label="Mốc thời gian" value={f.dateBasis} onChange={event => patch({ dateBasis: event.target.value })}><option value="as_of_date">Ngày cập nhật EOD</option>{isGrowth ? <option value="reviewed_on">Ngày xác minh Fundamental</option> : <option value="weekly_date">Ngày đóng tuần</option>}</SoftSelect></FilterField></div>
      <div id="investment-filter-dateFrom"><DateField label="Từ ngày" value={f.dateFrom} onChange={value => { patch({ dateFrom: value }); setRange('CUSTOM') }}/></div>
      <div id="investment-filter-dateTo"><DateField label="Đến ngày" value={f.dateTo} onChange={value => { patch({ dateTo: value }); setRange('CUSTOM') }}/></div>
      <button type="button" className="secondary-button investment-reset" onClick={() => { onChange(emptyInvestmentFilters()); setRange('ALL') }}>Xóa bộ lọc cột</button>
    </div>}
    <div className="timeframe-tabs signal-history-ranges investment-date-ranges" role="group" aria-label="Khoảng thời gian lọc">{signalHistoryRanges.map(value => <button type="button" key={value} className={range === value ? 'active' : ''} aria-pressed={range === value} disabled={!latestDate && value !== 'ALL'} onClick={() => { const window = investmentRange(value, latestDate); if (window) { patch(window); setRange(value) } }}>{value === 'ALL' ? 'Tất cả' : value}</button>)}</div>
    {(f.dateFrom || f.dateTo) && <p className="muted investment-date-note">{formatDate(f.dateFrom)} – {formatDate(f.dateTo)} · Áp dụng cho mốc thời gian đã chọn trên bản phân tích hiện tại; không tái dựng dữ liệu quá khứ.</p>}
  </>
}

export function InvestmentFilterHeading({ label, target, onFilter, active = false }: { label: string; target: string; onFilter: (target: string) => void; active?: boolean }) {
  return <button type="button" className={`investment-column-heading${active ? ' active' : ''}`} onClick={() => onFilter(target)} aria-controls="investment-advanced" aria-label={`Lọc cột ${label}`} title={`Lọc ${label}`}><span>{label}</span><Filter size={13}/></button>
}
