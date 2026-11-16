import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Globe, Landmark, Radar, RefreshCw, Search } from 'lucide-react'
import { formatDate } from '../lib/date'
import { MARKET_PRICE_TO_VND } from '../lib/marketUnits'
import { supabase } from '../lib/supabase'
import { DateField } from './DateField'
import './market-flow-radar.css'

type Option = readonly [string, string]
const exchanges = [['all', 'Cả 3 sàn'], ['HOSE', 'HOSE'], ['HNX', 'HNX'], ['UPCOM', 'UPCoM']] as const
const categories = [
  { id: 'foreign', label: 'Khối ngoại nắm giữ', note: 'Giao dịch, sở hữu và room', icon: Globe, tone: 'foreign' },
  { id: 'proprietary', label: 'Tự doanh nắm giữ', note: 'Giao dịch tự doanh CTCK', icon: Landmark, tone: 'proprietary' },
  { id: 'large', label: 'Lệnh ≥ 1 tỷ', note: 'Giá trị mỗi lần khớp', icon: Radar, tone: 'large' },
  { id: 'medium', label: 'Lệnh 200 tr – dưới 1 tỷ', note: 'Giá trị mỗi lần khớp', icon: Radar, tone: 'medium' },
  { id: 'small', label: 'Lệnh < 200 tr', note: 'Giá trị mỗi lần khớp', icon: Radar, tone: 'small' },
] as const
const periods = [['1', 'Phiên gần nhất'], ['5', '5 phiên'], ['20', '20 phiên'], ['50', '50 phiên'], ['200', '200 phiên'], ['ytd', 'YTD'], ['custom', 'Tuỳ chọn']] as const
const orders = [['buy', 'Mua ròng'], ['sell', 'Bán ròng']] as const
const pageSize = 10
const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

type Leader = { symbol: string; exchange: string; net_value: number; net_volume: number | null }
type FlowRow = {
  symbol: string; exchange: string; company_name: string | null; last_close_vnd: number | null; avg_buy_price: number | null
  buy_value: number | null; sell_value: number | null; net_value: number | null
  buy_volume: number | null; sell_volume: number | null; net_volume: number | null
  matched_value: number | null; unknown_value: number | null; trade_count: number | null
  holdings: number | null; holdings_date: string | null; ownership_pct: number | null; ownership_date: string | null
  room_remaining: number | null; room_date: string | null; observed: number; source: string; partial: boolean
}
type Dashboard = {
  coverage: { exchange: string; latest: string; observed: number; partial: boolean }[]; rows: FlowRow[]
  net_value: number | null; net_volume: number | null; strongest_buy: Leader | null; strongest_sell: Leader | null
}
type FlowDay = { trading_date: string; buy_value: number | null; sell_value: number | null }

const dayLabel = (day: string | null) => day ? formatDate(day) : '—'
const quantity = (value: number | null | undefined, signed = false) => value == null ? '—' : `${signed && value > 0 ? '+' : ''}${integer.format(value)}`
const billions = (value: number | null | undefined, signed = false) => value == null ? '—' : `${signed && value > 0 ? '+' : ''}${decimal.format(value / 1e9)}`
const price = (value: number | null) => value == null ? '—' : decimal.format(value / MARKET_PRICE_TO_VND)
const direction = (value: number | null | undefined) => Math.sign(value ?? 0)
const percent = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${decimal.format(value)}%`
const rowKey = (row: FlowRow) => `${row.exchange}:${row.symbol}`
const exchangeLabel = (value: string) => value === 'UPCOM' ? 'UPCoM' : value

function Chips({ label, options, value, onChange }: { label: string; options: readonly Option[]; value: string; onChange: (next: string) => void }) {
  return <div className="radar-chips" role="group" aria-label={label}>{options.map(([key, text]) =>
    <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>
  )}</div>
}

function LeaderCard({ title, leader, side }: { title: string; leader?: Leader | null; side: 1 | -1 }) {
  return <div className="radar-stat" data-direction={leader ? side : 0}>
    <dt>{title}{side > 0 ? <ArrowUpRight size={15} aria-hidden="true"/> : <ArrowDownRight size={15} aria-hidden="true"/>}</dt>
    <dd>{leader?.symbol ?? '—'}{leader && <small>{exchangeLabel(leader.exchange)}</small>}</dd>
    {leader && <dd className="radar-stat-note">{billions(leader.net_value, true)} tỷ{leader.net_volume != null && ` · ${quantity(leader.net_volume, true)} CP`}</dd>}
  </div>
}

function rowMetrics(row: FlowRow) {
  const costComparison = row.last_close_vnd != null && row.avg_buy_price != null && row.avg_buy_price > 0
    ? (row.last_close_vnd / row.avg_buy_price - 1) * 100 : null
  return [
    { label: 'Thị giá', unit: 'nghìn đ', value: price(row.last_close_vnd), primary: true },
    { label: 'Giá nắm giữ', unit: 'nghìn đ · BQ*', value: price(row.avg_buy_price), primary: false },
    { label: 'Hiệu suất giá vốn', unit: 'tham chiếu*', value: percent(costComparison), sign: direction(costComparison), primary: false },
    { label: 'GT mua', unit: 'tỷ đ', value: billions(row.buy_value), primary: false },
    { label: 'GT bán', unit: 'tỷ đ', value: billions(row.sell_value), primary: false },
    { label: 'GT mua ròng', unit: 'tỷ đ', value: billions(row.net_value, true), sign: direction(row.net_value), primary: true },
    { label: 'KL mua', unit: 'CP', value: quantity(row.buy_volume), primary: false },
    { label: 'KL bán', unit: 'CP', value: quantity(row.sell_volume), primary: false },
    { label: 'KL mua ròng', unit: 'CP', value: quantity(row.net_volume, true), sign: direction(row.net_volume), primary: true },
    { label: 'SL lệnh', unit: 'lần khớp', value: quantity(row.trade_count), primary: true },
  ]
}

function RowDetails({ row, expected, sized, history, loading, error }: { row: FlowRow; expected: number; sized: boolean; history?: FlowDay[]; loading: boolean; error: boolean }) {
  return <div className="radar-details">
    <dl className="radar-mobile-metrics">{rowMetrics(row).filter(metric => !metric.primary).map(metric =>
      <div key={metric.label}><dt>{metric.label} · {metric.unit}</dt><dd data-direction={metric.sign}>{metric.value}</dd></div>
    )}</dl>
    <p className="radar-meta">{row.source} · {row.observed}/{expected} phiên{row.partial && ' · Mẫu giới hạn'}</p>
    {!sized && <p className="radar-meta">Sở hữu {quantity(row.holdings)} CP{row.holdings_date && ` (${dayLabel(row.holdings_date)})`}
      {row.ownership_pct != null && ` · ${decimal.format(row.ownership_pct)}% (${dayLabel(row.ownership_date)})`}
      {row.room_remaining != null && ` · Room ${quantity(row.room_remaining)} CP (${dayLabel(row.room_date)})`}</p>}
    {sized && <p className="radar-meta">Giá trị khớp {billions(row.matched_value)} tỷ · Chưa rõ chiều {billions(row.unknown_value)} tỷ</p>}
    <details className="radar-history"><summary>{expected > 260 ? 'Lịch sử · tối đa 260 phiên có dữ liệu gần nhất' : 'Lịch sử từng phiên'}</summary>
      {loading && <p className="radar-meta" role="status">Đang tải lịch sử…</p>}
      {error && <p className="radar-meta" role="alert">Không tải được lịch sử.</p>}
      {Boolean(history?.length) && <div className="radar-history-scroll"><table><thead><tr><th scope="col">Phiên</th><th scope="col">Mua (tỷ)</th><th scope="col">Bán (tỷ)</th><th scope="col">Ròng (tỷ)</th></tr></thead>
        <tbody>{history?.map(day => {
          const net = day.buy_value == null || day.sell_value == null ? null : day.buy_value - day.sell_value
          return <tr key={day.trading_date}><th scope="row">{dayLabel(day.trading_date)}</th><td>{billions(day.buy_value)}</td><td>{billions(day.sell_value)}</td><td data-direction={direction(net)}>{billions(net, true)}</td></tr>
        })}</tbody></table></div>}
    </details>
  </div>
}

export function MarketFlowRadar({ authenticated, active, tradingDates }: { authenticated: boolean; active: boolean; tradingDates: string[] }) {
  const [exchange, setExchange] = useState('all')
  const [category, setCategory] = useState<string>('foreign')
  const [period, setPeriod] = useState('1')
  const [order, setOrder] = useState('buy')
  const [rangeOpen, setRangeOpen] = useState(false)
  const [draftRange, setDraftRange] = useState({ start: '', end: '' })
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' })
  const [search, setSearch] = useState('')
  const [focused, setFocused] = useState('')
  const [page, setPage] = useState(0)
  const latest = tradingDates.at(-1) ?? ''
  const sized = category !== 'foreign' && category !== 'proprietary'
  const method = sized ? 'continuous' : 'total'
  const earliest = tradingDates[0] ?? ''
  const rangeError = draftRange.start && draftRange.end && (draftRange.start > draftRange.end
    ? 'Ngày bắt đầu phải sớm hơn hoặc trùng ngày kết thúc.'
    : draftRange.start < earliest || draftRange.end > latest ? 'Chọn ngày trong phạm vi lịch giao dịch đã công bố.' : '')
  const dates = period === 'custom' ? tradingDates.filter(day => day >= appliedRange.start && day <= appliedRange.end)
    : period === 'ytd' ? tradingDates.filter(day => day.startsWith(latest.slice(0, 4)))
    : tradingDates.slice(-Number(period))
  const first = dates[0] ?? ''
  const last = dates.at(-1) ?? ''
  const ready = active && authenticated && Boolean(supabase && first && last)
  const searchTerm = search.trim().toUpperCase()
  const orderOptions = sized ? [...orders, ['size', 'Giá trị khớp'] as const] : [...orders, category === 'foreign' ? ['ownership', 'Sở hữu (%)'] as const : ['holdings', 'SL nắm giữ'] as const]
  const query = useQuery({
    queryKey: ['market-radar-dashboard', first, last, exchange, category, order, searchTerm], enabled: ready, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc('market_radar_dashboard', { p_start: first, p_end: last, p_exchange: exchange, p_category: category, p_order: order, p_search: searchTerm })
      if (error) throw error
      return data as Dashboard
    },
  })
  const rows = query.data?.rows ?? []
  const maxPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
  const currentPage = Math.min(page, maxPage)
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const focus = visible.find(row => rowKey(row) === focused)
  const history = useQuery({
    queryKey: ['market-radar-history', focused, category, first, last], enabled: ready && Boolean(focus), staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('market_radar_daily').select('trading_date,buy_value,sell_value')
        .eq('exchange', focus!.exchange).eq('symbol', focus!.symbol).eq('category', category).eq('method', method)
        .gte('trading_date', first).lte('trading_date', last).order('trading_date', { ascending: false }).limit(260)
      if (error) throw error
      return data as FlowDay[]
    },
  })
  const scope = exchanges.filter(([id]) => id !== 'all' && (exchange === 'all' || exchange === id))
  function resetRows() { setPage(0); setFocused('') }
  function choosePeriod(next: string) {
    if (next === 'custom') {
      if (!rangeOpen) setDraftRange(period === 'custom' ? appliedRange : { start: first, end: last })
      setRangeOpen(true)
      return
    }
    setRangeOpen(false)
    setPeriod(next)
    resetRows()
  }

  return <section className="panel market-radar" aria-labelledby="market-radar-title">
    <header className="radar-heading">
      <div className="radar-title"><span><Radar size={22} aria-hidden="true"/></span><div><h2 id="market-radar-title">Radar dòng tiền</h2><p>Dữ liệu cuối ngày · HOSE, HNX và UPCoM</p></div></div>
      <button type="button" className="secondary-button radar-refresh" disabled={!ready || query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} aria-hidden="true"/> Làm mới</button>
    </header>

    <div className="radar-categories" role="group" aria-label="Nhóm dòng tiền">{categories.map(({ id, label, note, icon: Icon, tone }) =>
      <button key={id} type="button" data-tone={tone} aria-pressed={category === id} onClick={() => { setCategory(id); setOrder('buy'); resetRows() }}>
        <span className="radar-category-icon"><Icon size={17} aria-hidden="true"/></span><span><strong>{label}</strong><small>{note}</small></span>
      </button>
    )}</div>

    <div className="radar-filter-bar">
      <div className="radar-filter-group"><span className="radar-filter-label"><CalendarDays size={15} aria-hidden="true"/> Chu kỳ</span>
        <Chips label="Chu kỳ" options={periods} value={rangeOpen ? 'custom' : period} onChange={choosePeriod}/>
      </div>
      <label className="radar-search"><Search size={16} aria-hidden="true"/><input type="search" aria-label="Tìm mã cổ phiếu" placeholder="Tìm mã cổ phiếu…" value={search} maxLength={10} onChange={event => { setSearch(event.target.value); resetRows() }}/></label>
    </div>
    {rangeOpen && <form className="radar-custom-dates" aria-label="Khoảng ngày giao dịch" onSubmit={event => {
      event.preventDefault()
      if (!latest || !draftRange.start || !draftRange.end || rangeError) return
      setAppliedRange(draftRange)
      setPeriod('custom')
      resetRows()
    }}>
      <DateField label="Từ ngày" value={draftRange.start} min={earliest} max={latest} required onChange={start => setDraftRange(range => ({ ...range, start }))}/>
      <DateField label="Đến ngày" value={draftRange.end} min={earliest} max={latest} required onChange={end => setDraftRange(range => ({ ...range, end }))}/>
      <button type="submit" className="secondary-button" disabled={!latest || !draftRange.start || !draftRange.end || Boolean(rangeError)}>Áp dụng</button>
      {rangeError && <p className="radar-date-error" role="alert">{rangeError}</p>}
    </form>}
    <div className="radar-filter-bar radar-filter-secondary">
      <div className="radar-filter-group"><span className="radar-filter-label">Sàn</span><Chips label="Sàn giao dịch" options={exchanges} value={exchange} onChange={value => { setExchange(value); resetRows() }}/></div>
      <div className="radar-filter-group"><span className="radar-filter-label">Xếp hạng</span><Chips label="Xếp hạng" options={orderOptions} value={order} onChange={value => { setOrder(value); resetRows() }}/></div>
    </div>

    <dl className="radar-summary" aria-label="Tổng hợp theo nhóm, sàn và chu kỳ">
      <div className="radar-stat" data-direction={direction(query.data?.net_value)}><dt>Tổng mua ròng</dt><dd>{billions(query.data?.net_value, true)} <small>tỷ</small></dd></div>
      <div className="radar-stat" data-direction={direction(query.data?.net_volume)}><dt>Tổng khối lượng ròng</dt><dd>{quantity(query.data?.net_volume, true)} <small>CP</small></dd></div>
      <LeaderCard title="Gom ròng mạnh nhất" leader={query.data?.strongest_buy} side={1}/>
      <LeaderCard title="Xả ròng mạnh nhất" leader={query.data?.strongest_sell} side={-1}/>
    </dl>

    <div className="radar-table-heading"><div><h3>{searchTerm ? 'Kết quả tìm mã' : `Top ${rows.length || 20} cổ phiếu`}</h3>
      {last && <p className="radar-meta">{first === last ? dayLabel(last) : `${dayLabel(first)} – ${dayLabel(last)}`} · {dates.length} phiên{sized && ' · Khớp lệnh liên tục'}</p>}</div>
      {query.data && <div className="radar-coverage" aria-label="Độ phủ theo sàn">{scope.map(([id, name]) => {
        const item = query.data.coverage.find(entry => entry.exchange === id)
        return <span key={id} title={item ? `Phiên mới nhất có dữ liệu ${dayLabel(item.latest)}` : 'Chưa có dữ liệu'}>{name} <b>{item?.observed ?? 0}/{dates.length}</b>{item?.partial && <small> · Mẫu giới hạn</small>}</span>
      })}</div>}
    </div>
    {query.isError && <p className="market-error" role="alert">Không tải được Radar. <button type="button" className="secondary-button" onClick={() => void query.refetch()}>Thử lại</button></p>}
    {!rows.length && !query.isError && <p className="market-empty" role="status">{query.isFetching ? 'Đang tải xếp hạng…' : !dates.length && period === 'custom' ? 'Khoảng ngày đã chọn chưa có phiên giao dịch.' : query.data?.coverage.length ? 'Không có mã phù hợp với bộ lọc.' : 'Chưa đủ dữ liệu cho lựa chọn này.'}</p>}

    {visible.length > 0 && <>
      <div className="radar-table-frame"><table className="market-radar-table">
        <thead><tr><th scope="col">Mã / Sàn</th>{rowMetrics(visible[0]).map(metric =>
          <th key={metric.label} scope="col" className={metric.primary ? '' : 'radar-desktop-cell'}>{metric.label}<span>{metric.unit}</span></th>
        )}</tr></thead>
        <tbody>{visible.map((row, index) => {
          const key = rowKey(row)
          const expanded = focused === key
          const metrics = rowMetrics(row)
          return <Fragment key={key}><tr className="radar-stock-row">
            <th scope="row"><button type="button" className="radar-stock" aria-expanded={expanded} aria-label={`Chi tiết ${row.symbol}`} onClick={() => setFocused(expanded ? '' : key)}>
              <span className="radar-rank">{currentPage * pageSize + index + 1}</span><span className="radar-stock-label"><strong>{row.symbol}</strong><small>{exchangeLabel(row.exchange)}{row.partial && ' · Mẫu giới hạn'}</small></span><ChevronDown size={14} aria-hidden="true"/>
            </button>{row.company_name && <small className="radar-company" title={row.company_name}>{row.company_name}</small>}</th>
            {metrics.map(metric => <td key={metric.label} className={metric.primary ? '' : 'radar-desktop-cell'} data-direction={metric.sign}>{metric.value}</td>)}
          </tr>{expanded && <tr className="radar-detail-row"><td colSpan={metrics.length + 1}><RowDetails row={row} expected={dates.length} sized={sized} history={history.data} loading={history.isFetching} error={history.isError}/></td></tr>}</Fragment>
        })}</tbody>
      </table></div>
      <div className="radar-table-footer"><p className="radar-meta">* Giá mua bình quân trong kỳ dùng để tham chiếu. Hiệu suất tính theo thị giá so với giá mua bình quân.</p>
        {maxPage > 0 && <nav className="radar-pages" aria-label="Trang bảng xếp hạng"><button type="button" aria-label="Trang trước" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setFocused('') }}><ChevronLeft size={16}/></button><span>{currentPage + 1}/{maxPage + 1}</span><button type="button" aria-label="Trang sau" disabled={currentPage === maxPage} onClick={() => { setPage(currentPage + 1); setFocused('') }}><ChevronRight size={16}/></button></nav>}
      </div>
    </>}
    <p className="radar-meta radar-scope-note">{sized ? 'Theo các mã trong Prot Universe. Chiều mua/bán chủ động do nguồn cung cấp.' : 'SL lệnh hiện — khi báo cáo của nhóm chỉ có số liệu mua/bán tổng hợp.'}</p>
  </section>
}
