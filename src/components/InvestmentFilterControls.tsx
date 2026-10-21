import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { DateField } from './DateField'
import { FilterField } from './FilterField'
import { SoftSelect } from './SoftSelect'
import { InvestmentRangeFilter } from './InvestmentRangeFilter'
import { cycleLabels, eventLabels, setupLabels, statusLabels } from '../lib/investmentModules'
import { emptyInvestmentFilters, invalidInvestmentRange, investmentRange, type InvestmentFilters } from '../lib/investmentFilters'
import { signalHistoryRanges, type SignalHistoryRange } from '../lib/signalHistoryRange'
import { formatDate } from '../lib/date'

type Props = { filters: InvestmentFilters; onChange: (filters: InvestmentFilters) => void; isGrowth: boolean; sectors: string[]; exchanges: string[]; tradingStatuses: string[]; latestDate: string | null }
export function InvestmentFilterControls({ filters: f, onChange, isGrowth, sectors, exchanges, tradingStatuses, latestDate }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [range, setRange] = useState<SignalHistoryRange>('ALL')
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:760px)').matches)
  const sheet = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setAdvancedOpen(false), [])
  useDialogFocus(advancedOpen && mobile, sheet, close)
  useEffect(() => {
    const query = matchMedia('(max-width:760px)')
    const update = () => { setMobile(query.matches); setAdvancedOpen(false) }
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const patch = (value: Partial<InvestmentFilters>) => onChange({ ...f, ...value })
  const primarySelect = (key: 'setup' | 'stage' | 'evidence' | 'event', label: string, choices: [string, string][]) => <label className={'investment-primary-field' + (key === 'setup' || key === 'stage' ? ' investment-primary-state' : '')}><span>{label}</span><SoftSelect aria-label={label} value={f[key]} onChange={event => patch({ [key]: event.target.value })}><option value="ALL">Tất cả</option>{choices.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</SoftSelect></label>
  const primaryRange = (label: string, minKey: 'rsMin' | 'pivotMin' | 'liquidityMin', maxKey: 'rsMax' | 'pivotMax' | 'liquidityMax', suffix = '', min?: number, max?: number) => <InvestmentRangeFilter label={label} from={f[minKey]} to={f[maxKey]} suffix={suffix} min={min} max={max} onChange={(from, to) => patch({ [minKey]: from, [maxKey]: to })}/>
  const select = (key: keyof InvestmentFilters, label: string, choices: [string, string][]) => <div id={`investment-filter-${key}`}><FilterField label={label}><SoftSelect aria-label={label} value={String(f[key])} onChange={event => patch({ [key]: event.target.value })}><option value="ALL">Tất cả</option>{choices.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</SoftSelect></FilterField></div>
  const numeric = (key: 'rsMin' | 'rsMax' | 'pivotMin' | 'pivotMax' | 'liquidityMin' | 'liquidityMax', label: string, min?: number, max?: number) => <FilterField label={label}><input type="number" step="any" min={min} max={max} value={f[key]} placeholder="Không giới hạn" onChange={event => patch({ [key]: event.target.value })}/></FilterField>
  const activeCount = [f.query, f.sector !== 'ALL', f.setup !== 'ALL', f.stage !== 'ALL', f.evidence !== 'ALL', f.event !== 'ALL', f.exchange !== 'ALL', f.tradingStatus !== 'ALL', f.watch !== 'ALL', f.rsMin || f.rsMax, f.pivotMin || f.pivotMax, f.liquidityMin || f.liquidityMax, f.dateFrom || f.dateTo, ...Object.values(f.checks).map(value => value !== 'ALL')].filter(Boolean).length
  const advanced = <div id="investment-advanced" className="signal-search-advanced investment-advanced">
    {mobile && <>{isGrowth ? <>{numeric('rsMin', 'RS Prot từ', 0, 100)}{numeric('rsMax', 'RS Prot đến', 0, 100)}{numeric('pivotMin', 'Đến pivot từ (%)')}{numeric('pivotMax', 'Đến pivot đến (%)')}</> : <>{select('evidence', 'Bằng chứng', [['SUPPORTED', 'Hai tuần đồng thuận'], ['TENTATIVE', 'Đang chuyển tiếp'], ['INSUFFICIENT', 'Chưa đủ bằng chứng']])}{select('event', 'Sự kiện ngày', [['NONE', 'Chưa có sự kiện'], ...Object.entries(eventLabels)])}</>}{numeric('liquidityMin', 'TV20 từ (tỷ)', 0)}{numeric('liquidityMax', 'TV20 đến (tỷ)', 0)}</>}
    {select('exchange', 'Sàn giao dịch', exchanges.map(value => [value, value]))}
    {select('tradingStatus', 'Trạng thái giao dịch', tradingStatuses.map(value => [value, value]))}
    {select('watch', 'Theo dõi', [['WATCHED', 'Có trong Watchlist'], ['UNWATCHED', 'Chưa trong Watchlist']])}
    {isGrowth && Object.keys({ C: 1, A: 1, N: 1, S: 1, L: 1, I: 1, M: 1 }).map(letter => <FilterField key={letter} label={`Tiêu chí ${letter}`}><SoftSelect aria-label={`Lọc tiêu chí ${letter}`} value={f.checks[letter] ?? 'ALL'} onChange={event => patch({ checks: { ...f.checks, [letter]: event.target.value } })}><option value="ALL">Tất cả</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SoftSelect></FilterField>)}
    <FilterField label="Mốc thời gian"><SoftSelect aria-label="Mốc thời gian" value={f.dateBasis} onChange={event => { patch({ dateBasis: event.target.value }); setRange('CUSTOM') }}><option value="as_of_date">Ngày cập nhật EOD</option>{isGrowth ? <option value="reviewed_on">Ngày xác minh Fundamental</option> : <option value="weekly_date">Tuần đóng</option>}</SoftSelect></FilterField>
    <DateField label="Từ ngày" value={f.dateFrom} onChange={value => { patch({ dateFrom: value }); setRange('CUSTOM') }}/>
    <DateField label="Đến ngày" value={f.dateTo} onChange={value => { patch({ dateTo: value }); setRange('CUSTOM') }}/>
    <button type="button" className="secondary-button investment-reset" onClick={() => { onChange(emptyInvestmentFilters()); setRange('ALL') }}>Xóa tất cả bộ lọc</button>
  </div>
  return <>
    <div className="investment-filter-scroll"><div className="investment-primary-toolbar">
      <label className="investment-primary-field investment-primary-search"><span>Tìm mã</span><span className="investment-primary-search-box"><Search size={15}/><input aria-label="Tìm mã hoặc doanh nghiệp" placeholder="Tìm mã…" value={f.query} onChange={event => patch({ query: event.target.value })}/></span></label>
      <label className="investment-primary-field investment-primary-sector"><span>Ngành</span><SoftSelect aria-label="Lọc ngành" value={f.sector} onChange={event => patch({ sector: event.target.value })}><option value="ALL">Tất cả ngành</option>{sectors.map(value => <option key={value}>{value}</option>)}</SoftSelect></label>
      {isGrowth ? primarySelect('setup', 'Trạng thái giá', Object.entries(setupLabels)) : primarySelect('stage', 'Trạng thái tuần', Object.entries(cycleLabels))}
      {!mobile && (isGrowth ? <>{primaryRange('RS Prot', 'rsMin', 'rsMax', '', 0, 100)}{primaryRange('Đến pivot', 'pivotMin', 'pivotMax', '%')}{primaryRange('Thanh khoản TV20', 'liquidityMin', 'liquidityMax', ' tỷ', 0)}</> : <>{primarySelect('evidence', 'Bằng chứng', [['SUPPORTED', 'Hai tuần đồng thuận'], ['TENTATIVE', 'Đang chuyển tiếp'], ['INSUFFICIENT', 'Chưa đủ bằng chứng']])}{primarySelect('event', 'Sự kiện ngày', [['NONE', 'Chưa có sự kiện'], ...Object.entries(eventLabels)])}<InvestmentRangeFilter kind="date" label="Tuần đóng" from={f.dateBasis === 'weekly_date' ? f.dateFrom : ''} to={f.dateBasis === 'weekly_date' ? f.dateTo : ''} onChange={(from, to) => { patch({ dateBasis: 'weekly_date', dateFrom: from, dateTo: to }); setRange('CUSTOM') }}/>{primaryRange('Thanh khoản', 'liquidityMin', 'liquidityMax', ' tỷ', 0)}</>)}
      <button type="button" className={advancedOpen ? 'investment-primary-advanced active' : 'investment-primary-advanced'} aria-expanded={advancedOpen} aria-controls="investment-advanced" onClick={() => setAdvancedOpen(value => !value)}><SlidersHorizontal size={15}/>{mobile ? `Bộ lọc${activeCount ? ` · ${activeCount}` : ''}` : 'Bộ lọc nâng cao'}</button>
    </div></div>
    <p className="investment-filter-scope">Lọc theo mốc ngày của bản phân tích hiện tại · {f.dateBasis === 'weekly_date' ? 'Tuần đóng' : f.dateBasis === 'reviewed_on' ? 'Ngày xác minh Fundamental' : 'Ngày cập nhật EOD'} đến {formatDate(latestDate)}</p>
    {advancedOpen && (mobile ? createPortal(<div className="investment-filter-backdrop" onClick={close}><div ref={sheet} role="dialog" aria-modal="true" aria-labelledby="investment-filter-title" tabIndex={-1} className="investment-filter-sheet" onClick={event => event.stopPropagation()}><header><h2 id="investment-filter-title">Bộ lọc {isGrowth ? 'CAN SLIM' : 'Chu kỳ'}</h2><button type="button" aria-label="Đóng bộ lọc" onClick={close}><X size={20}/></button></header>{advanced}{invalidInvestmentRange(f) && <p role="alert" className="form-error">Khoảng lọc không hợp lệ: giá trị Từ phải nhỏ hơn hoặc bằng Đến.</p>}<footer><button type="button" className="secondary-button" disabled={invalidInvestmentRange(f)} onClick={close}>Xem kết quả</button></footer></div></div>, document.body) : advanced)}
    <div className="timeframe-tabs signal-history-ranges investment-date-ranges" role="group" aria-label="Khoảng thời gian lọc trên bản hiện tại">{signalHistoryRanges.map(value => <button type="button" key={value} className={range === value ? 'active' : ''} aria-pressed={range === value} disabled={!latestDate && value !== 'ALL'} onClick={() => { const window = investmentRange(value, latestDate); if (window) { patch(window); setRange(value) } }}>{value === 'ALL' ? 'Tất cả' : value}</button>)}</div>
    {(f.dateFrom || f.dateTo) && <p className="muted investment-date-note">{formatDate(f.dateFrom)} – {formatDate(f.dateTo)} · Áp dụng cho mốc thời gian đã chọn trên bản phân tích hiện tại; không tái dựng dữ liệu quá khứ.</p>}
  </>
}
