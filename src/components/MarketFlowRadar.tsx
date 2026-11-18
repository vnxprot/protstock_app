import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ColorType, HistogramSeries, LineSeries, createChart, type AutoscaleInfo, type LineData, type LineSeriesPartialOptions } from 'lightweight-charts'
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Globe, Landmark, Radar, RefreshCw, RotateCcwClock, Search, X } from 'lucide-react'
import { formatDate, todayInVietnam } from '../lib/date'
import { MARKET_PRICE_TO_VND } from '../lib/marketUnits'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/theme'
import { DateField } from './DateField'
import { RadarReplay } from './RadarReplay'
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
const tapeModes = [['continuous', 'Từng lần khớp'], ['continuous_cluster', 'Cụm khớp'], ['auction', 'Định kỳ']] as const
const sizeOrder = ['size', 'Giá trị khớp'] as const
const historyPeriods = [['selection', 'Theo bộ lọc Radar'], ['20', '20 phiên'], ['50', '50 phiên'], ['200', '200 phiên']] as const
const pageSize = 10
const historyLimit = 260
const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

type Leader = { symbol: string; exchange: string; net_value: number; net_volume: number | null }
type AuctionBatch = { count: number; volume: number; value: number }
type FlowRow = {
  symbol: string; exchange: string; company_name: string | null; last_close_vnd: number | null; avg_buy_price: number | null
  buy_value: number | null; sell_value: number | null; net_value: number | null
  buy_volume: number | null; sell_volume: number | null; net_volume: number | null
  matched_value: number | null; unknown_value: number | null; trade_count: number | null
  buy_count: number | null; sell_count: number | null; unknown_count: number | null; unknown_volume: number | null
  holdings: number | null; holdings_date: string | null; ownership_pct: number | null; ownership_date: string | null
  room_remaining: number | null; room_date: string | null; observed: number; expected: number | null; source: string | null; partial: boolean
  auction_breakdown?: Partial<Record<'opening' | 'closing' | 'other', AuctionBatch>> | null
}
type Dashboard = {
  coverage: { exchange: string; latest: string | null; observed: number; partial: boolean; ready: number | null; universe: number | null }[]; rows: FlowRow[]
  net_value: number | null; net_volume: number | null; strongest_buy: Leader | null; strongest_sell: Leader | null
}
type FlowDay = { trading_date: string; buy_value: number | null; sell_value: number | null; buy_volume: number | null; sell_volume: number | null; unknown_value: number | null; unknown_volume: number | null; trade_count: number | null; partial: boolean; tape_volume: number | null; reference_volume: number | null }
type LiveGroup = 'large' | 'medium' | 'small'
type LiveAmounts = [number, number, number, number, number]
type LiveMinute = [number, LiveGroup, number, number]
type LiveRow = { symbol: string; price: number; partial: boolean; groups: Partial<Record<LiveGroup, LiveAmounts>>; minutes?: LiveMinute[] }
type LiveSnapshot = { exchange: string; day: string; updated_at: string; last_tick: number; rows: LiveRow[] }
const liveGroups: { id: LiveGroup; label: string; color: string }[] = [
  { id: 'large', label: '≥ 1 tỷ', color: '#b97813' },
  { id: 'medium', label: '200 tr – dưới 1 tỷ', color: '#377fce' },
  { id: 'small', label: '< 200 tr', color: '#8356bb' },
]
const liveEmpty: LiveAmounts = [0, 0, 0, 0, 0]
const vnTime = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

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

function LiveHistory({ row, close }: { row: LiveRow; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [unit, setUnit] = useState('value')
  const theme = useTheme()
  const available = Boolean(row.minutes?.length && !row.partial)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  useEffect(() => {
    const element = host.current
    if (!element || !available) return
    const palette = getComputedStyle(element)
    const color = (name: string) => palette.getPropertyValue(name).trim()
    const timeLabel = (time: number | string | object) => typeof time === 'number' ? vnTime.format(time * 1000) : ''
    const chart = createChart(element, { autoSize: true,
      layout: { background: { type: ColorType.Solid, color: color('--surface') }, textColor: color('--muted') },
      grid: { vertLines: { visible: false }, horzLines: { color: color('--line') } },
      localization: { timeFormatter: timeLabel, priceFormatter: (value: number) => decimal.format(value) },
      timeScale: { timeVisible: true, secondsVisible: false, tickMarkFormatter: timeLabel },
    })
    const points = new Map<number, Map<LiveGroup, number>>()
    for (const [time, group, value, volume] of row.minutes ?? []) {
      if (!points.has(time)) points.set(time, new Map())
      points.get(time)!.set(group, unit === 'value' ? value / 1e9 : volume)
    }
    liveGroups.forEach(({ id, color }, index) => {
      const line = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, pointMarkersVisible: points.size === 1 })
      let cumulative = 0
      line.setData([...points].map(([time, values]) => ({ time: time as import('lightweight-charts').UTCTimestamp, value: cumulative += values.get(id) ?? 0 })))
      if (!index) line.createPriceLine({ price: 0, color: palette.getPropertyValue('--line-bright').trim(), lineWidth: 1, axisLabelVisible: false })
    })
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [available, row.minutes, theme, unit])
  return <dialog ref={dialog} className="radar-history-dialog" onClose={close} aria-label={`Mua bán ròng trong phiên ${row.symbol}`}>
    <div className="radar-history"><header className="radar-table-heading"><h3>{row.symbol} · Ròng tích lũy trong phiên</h3>
      <button type="button" className="secondary-button" aria-label="Đóng biểu đồ" onClick={close}><X size={17}/></button></header>
      {available ? <><Chips label="Đơn vị" options={[[ 'value', 'Tỷ đồng' ], [ 'volume', 'Cổ phiếu' ]]} value={unit} onChange={setUnit}/>
        <div className="radar-chart-legend">{liveGroups.map(group => <span key={group.id} style={{ color: group.color }}>{group.label}</span>)}</div>
        <div ref={host} className="radar-history-chart" role="img" aria-label="Biểu đồ đường ba nhóm giá trị khớp SSI"/></>
        : <p className="radar-meta">{row.partial ? 'Băng khớp có khoảng thiếu. Chưa vẽ đường tích lũy.' : 'Mã chưa có bản tổng hợp từng phút trong danh sách theo dõi.'}</p>}
    </div>
  </dialog>
}

function LiveRadar({ authenticated, active }: { authenticated: boolean; active: boolean }) {
  const [exchange, setExchange] = useState('all')
  const [group, setGroup] = useState<LiveGroup>('large')
  const [sort, setSort] = useState('buy')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const day = todayInVietnam()
  const query = useQuery({ queryKey: ['ssi-market-radar-live'], enabled: Boolean(supabase && authenticated && active), retry: false,
    staleTime: 60_000, refetchInterval: 60_000, queryFn: async () => {
      const results = await Promise.all(exchanges.slice(1).map(async ([exchange]) => {
        const { data, error } = await supabase!.storage.from('market-radar-live').download(`${exchange}.json.gz`)
        if (error) {
          if (/not found|does not exist/i.test(error.message)) return null
          throw error
        }
        const stream = data.stream().pipeThrough(new DecompressionStream('gzip'))
        return { ...(await new Response(stream).json()), exchange } as LiveSnapshot
      }))
      return results.filter((row): row is LiveSnapshot => Boolean(row))
    } })
  const snapshots = (query.data ?? []).filter(item => item.day === day && (exchange === 'all' || item.exchange === exchange))
  const updated = snapshots.map(item => Date.parse(item.updated_at)).filter(Number.isFinite)
  const latestTrade = snapshots.length ? Math.max(...snapshots.map(item => item.last_tick)) : 0
  const rows = snapshots.flatMap(item => item.rows.map(row => ({ ...row, exchange: item.exchange })))
  const current = rows.find(row => row.symbol === selected)
  const summary = liveGroups.map(({ id, label }) => ({ label,
    value: rows.filter(row => !row.partial).reduce((sum, row) => { const [buy, sell] = row.groups[id] ?? liveEmpty; return sum + buy - sell }, 0) }))
  const visible = rows.filter(row => search ? row.symbol.includes(search.trim().toUpperCase()) : !row.partial).sort((a, b) => {
    const [ab, as] = a.groups[group] ?? liveEmpty
    const [bb, bs] = b.groups[group] ?? liveEmpty
    return ((bb - bs) - (ab - as)) * (sort === 'buy' ? 1 : -1)
  }).slice(0, 10)
  return <>
    <div className="radar-filter-bar radar-filter-secondary">
      <Chips label="Sàn trong phiên" options={exchanges} value={exchange} onChange={setExchange}/>
      <Chips label="Nhóm giá trị khớp" options={liveGroups.map(({ id, label }) => [id, label])} value={group} onChange={key => setGroup(key as LiveGroup)}/>
      <Chips label="Xếp hạng trong phiên" options={orders} value={sort} onChange={setSort}/>
      <label className="radar-search"><Search size={14}/><input type="search" placeholder="Tìm mã" aria-label="Tìm mã trong phiên" maxLength={10} value={search} onChange={event => setSearch(event.target.value)}/></label>
    </div>
    {snapshots.length ? <>
      <dl className="radar-summary radar-live-summary">{summary.map(item => <div key={item.label} className="radar-stat" data-direction={direction(item.value)}>
        <dt>{item.label}</dt><dd>{billions(item.value, true)} <small>tỷ ròng</small></dd></div>)}</dl>
      <p className="radar-meta">SSI · Tạm tính · {updated.length ? `Bản chụp ${vnTime.format(Math.min(...updated))}` : 'Thiếu giờ cập nhật'}{latestTrade > 0 && ` · Khớp mới nhất ${vnTime.format(latestTrade * 1000)}`} · {rows.filter(row => !row.partial).length}/{rows.length} mã liền mạch {updated.length && Date.now() - Math.min(...updated) > 180_000 ? ' · Dữ liệu đã cũ' : ''}</p>
      {visible.length ? <div className="radar-table-frame"><table className="market-radar-table"><thead><tr><th>Mã / Sàn</th><th>Giá</th><th>GT mua<span>tỷ đ</span></th><th>GT bán<span>tỷ đ</span></th><th>GT ròng<span>tỷ đ</span></th><th>KL ròng<span>CP</span></th><th>Lần khớp</th><th className="radar-actions">Biểu đồ</th></tr></thead>
        <tbody>{visible.map(row => { const [buy, sell, buyQty, sellQty, count] = row.groups[group] ?? liveEmpty
          return <tr key={row.symbol}><th scope="row">{row.symbol}<small className="radar-company">{exchangeLabel(row.exchange)}{row.partial && ' · Thiếu băng'}</small></th>
            <td>{price(row.price)}</td><td>{billions(buy)}</td><td>{billions(sell)}</td><td data-direction={direction(buy - sell)}>{billions(buy - sell, true)}</td>
            <td data-direction={direction(buyQty - sellQty)}>{quantity(buyQty - sellQty, true)}</td><td>{quantity(count)}</td><td className="radar-actions"><button type="button" className="radar-history-action" aria-label={`Biểu đồ ${row.symbol}`} aria-haspopup="dialog" onClick={() => setSelected(row.symbol)}><RotateCcwClock size={16}/></button></td></tr> })}</tbody>
      </table></div> : <p className="market-empty">Chưa có mã đủ dữ liệu hoặc phù hợp bộ lọc.</p>}
    </> : <p className="market-empty" role="status">{query.isFetching ? 'Đang đọc bản chụp SSI…' : query.isError ? 'Không tải được bản chụp SSI.' : 'Chưa có dữ liệu SSI trong phiên này.'}</p>}
    {current && <LiveHistory row={current} close={() => setSelected(null)}/>}
  </>
}

function LeaderCard({ title, leader, side }: { title: string; leader?: Leader | null; side: 1 | -1 }) {
  return <div className="radar-stat" data-direction={leader ? side : 0}>
    <dt>{title}{side > 0 ? <ArrowUpRight size={15} aria-hidden="true"/> : <ArrowDownRight size={15} aria-hidden="true"/>}</dt>
    <dd>{leader?.symbol ?? '—'}{leader && <small>{exchangeLabel(leader.exchange)}</small>}</dd>
    {leader && <dd className="radar-stat-note">{billions(leader.net_value, true)} tỷ{leader.net_volume != null && ` · ${quantity(leader.net_volume, true)} CP`}</dd>}
  </div>
}

function auctionPrice(value?: number | null, volume?: number | null) {
  return value != null && volume ? price(value / volume) : '—'
}

function auctionBatch(batch?: AuctionBatch) {
  return batch ? `${auctionPrice(batch.value, batch.volume)} nghìn · ${quantity(batch.volume)} CP · ${billions(batch.value)} tỷ · ${quantity(batch.count)} bản ghi` : '—'
}

function rowMetrics(row: FlowRow, countLabel: string, auction: boolean): { label: string; unit: string; value: string; primary: boolean; sign?: number }[] {
  if (auction) return [
    { label: 'Giá khớp BQ', unit: 'nghìn đ', value: auctionPrice(row.matched_value, row.unknown_volume), primary: true },
    { label: 'KL khớp', unit: 'CP', value: quantity(row.unknown_volume), primary: true },
    { label: 'GT khớp', unit: 'tỷ đ', value: billions(row.matched_value), primary: true },
    { label: 'Số bản ghi nguồn', unit: '', value: quantity(row.trade_count), primary: true },
    { label: 'Mở cửa', unit: '', value: auctionBatch(row.auction_breakdown?.opening), primary: false },
    { label: 'Đóng cửa', unit: '', value: auctionBatch(row.auction_breakdown?.closing), primary: false },
  ]
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
    { label: countLabel, unit: '', value: quantity(row.trade_count), primary: true },
  ]
}

function RowDetails({ row, expected, sized, countLabel, auction }: { row: FlowRow; expected: number; sized: boolean; countLabel: string; auction: boolean }) {
  return <div className="radar-details">
    <dl className="radar-mobile-metrics">{rowMetrics(row, countLabel, auction).filter(metric => !metric.primary).map(metric =>
      <div key={metric.label}><dt>{metric.label}{metric.unit && ` · ${metric.unit}`}</dt><dd data-direction={metric.sign}>{metric.value}</dd></div>
    )}</dl>
    <p className="radar-meta">{row.source ?? 'Chưa có nguồn'} · {row.observed}/{expected} phiên{sized && ' đã đối soát'}{row.partial && (sized ? ' · Thiếu băng khớp' : ' · Mẫu giới hạn')}</p>
    {!sized && <p className="radar-meta">Sở hữu {quantity(row.holdings)} CP{row.holdings_date && ` (${dayLabel(row.holdings_date)})`}
      {row.ownership_pct != null && ` · ${decimal.format(row.ownership_pct)}% (${dayLabel(row.ownership_date)})`}
      {row.room_remaining != null && ` · Room ${quantity(row.room_remaining)} CP (${dayLabel(row.room_date)})`}</p>}
    {sized && !auction && !row.partial && <p className="radar-meta">Mua {quantity(row.buy_count)} · Bán {quantity(row.sell_count)} · Chưa rõ chiều {quantity(row.unknown_count)}, {quantity(row.unknown_volume)} CP, {billions(row.unknown_value)} tỷ · Tổng giá trị khớp {billions(row.matched_value)} tỷ</p>}
    {auction && row.auction_breakdown?.other && <p className="radar-meta">Định kỳ khác · {auctionBatch(row.auction_breakdown.other)}</p>}
    {auction && !row.partial && !row.auction_breakdown && <p className="radar-meta">Phiên đã lưu chỉ có tổng định kỳ. Chi tiết mở cửa và đóng cửa cần nạp lại băng nguồn.</p>}
  </div>
}

function historyValue(day: FlowDay | undefined, sized: boolean, auction: boolean) {
  if (!day || (sized && (day.partial || day.reference_volume == null))) return null
  if (auction) return day.unknown_value
  return day.buy_value == null || day.sell_value == null ? null : day.buy_value - day.sell_value
}

function HistoryChart({ dates, history, sized, auction, onOpenDay }: { dates: string[]; history: FlowDay[]; sized: boolean; auction: boolean; onOpenDay: (day: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const openDay = useRef(onOpenDay)
  useEffect(() => { openDay.current = onOpenDay }, [onOpenDay])
  const theme = useTheme()
  const chartDates = dates.slice(-historyLimit)
  const hasValues = history.some(day => chartDates.includes(day.trading_date) && historyValue(day, sized, auction) != null)
  useEffect(() => {
    const element = host.current
    if (!element || !hasValues) return
    const palette = getComputedStyle(element)
    const color = (name: string) => palette.getPropertyValue(name).trim()
    const chart = createChart(element, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: color('--surface') }, textColor: color('--muted'), fontFamily: 'Inter, sans-serif' },
      grid: { vertLines: { visible: false }, horzLines: { color: color('--line') } },
      rightPriceScale: { borderColor: color('--line') }, timeScale: { borderColor: color('--line') },
      localization: { locale: 'vi-VN', priceFormatter: (value: number) => decimal.format(value) },
    })
    const byDate = new Map(history.map(day => [day.trading_date, day]))
    const points = dates.slice(-historyLimit).map(time => {
      const value = historyValue(byDate.get(time), sized, auction)
      return { time, value: value == null ? null : value / 1e9 }
    })
    const common = { priceLineVisible: false, lastValueVisible: false }
    if (auction) {
      const series = chart.addSeries(HistogramSeries, { ...common, base: 0, color: color('--radar-history-color') })
      series.setData(points.map(({ time, value }) => value == null ? { time } : { time, value }))
    } else {
      const timeline = chart.addSeries(LineSeries, common)
      timeline.setData(points.map(({ time }) => ({ time })))
      const segments: LineData[][] = []
      let segment: LineData[] | undefined
      for (const { time, value } of points) {
        if (value == null) {
          segment = undefined
          continue
        }
        if (!segment) {
          segment = []
          segments.push(segment)
        }
        segment.push({ time, value })
      }
      const options: LineSeriesPartialOptions = {
        ...common, color: color('--radar-history-color'), lineWidth: 2, pointMarkersVisible: true, pointMarkersRadius: 2,
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const info = original()
          if (!info?.priceRange) return info
          const { minValue, maxValue } = info.priceRange
          return { ...info, priceRange: { minValue: Math.min(0, minValue), maxValue: Math.max(0, maxValue) } }
        },
      }
      segments.forEach((data, index) => {
        const series = chart.addSeries(LineSeries, options)
        series.setData(data)
        if (index === 0) series.createPriceLine({ price: 0, color: color('--line-bright'), lineWidth: 1, axisLabelVisible: false })
      })
    }
    chart.subscribeClick(({ time }) => {
      if (typeof time === 'string' && chartDates.includes(time)) openDay.current(time)
    })
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [auction, dates, hasValues, history, sized, theme])
  if (!hasValues) return <p className="radar-meta">Chưa có giá trị đủ dữ liệu để vẽ biểu đồ.</p>
  return <div className="radar-history-chart-wrap">
    <div className="radar-chart-legend">{auction
      ? <span data-series="auction">Giá trị khớp (tỷ đồng)</span>
      : <span data-series="net">Giá trị mua/bán ròng (tỷ đồng)</span>}</div>
    <div ref={host} className="radar-history-chart" role="img" aria-label={auction ? 'Biểu đồ giá trị khớp định kỳ theo phiên' : 'Biểu đồ giá trị mua hoặc bán ròng theo phiên'}/>
  </div>
}

function RowHistory({ row, category, method, sized, auction, dates, recentDays, selectedDay, period, onPeriodChange, history, loading, error, retry, onClose }: {
  category: string; method: string; recentDays: string[]; selectedDay: string
  row: FlowRow; sized: boolean; auction: boolean; dates: string[]; period: string; onPeriodChange: (value: string) => void
  history?: FlowDay[]; loading: boolean; error: boolean; retry: () => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [mode, setMode] = useState('daily')
  const [day, setDay] = useState(selectedDay)
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const intraday = mode === 'intraday'
  const title = `${row.symbol} · ${intraday ? 'Dòng tiền trong phiên' : auction ? 'Lịch sử khớp định kỳ' : 'Lịch sử mua/bán ròng'}`
  const groupLabel = ({ large: 'Từ 1 tỷ trở lên', medium: 'Từ 200 triệu đến dưới 1 tỷ', small: 'Dưới 200 triệu',
    foreign: 'Khối ngoại', proprietary: 'Tự doanh' } as Record<string, string>)[category]
  const methodLabel = tapeModes.find(([id]) => id === method)?.[1]
  const periodLabel = dates.length === 1 ? dayLabel(dates[0]) : `${dayLabel(dates[0])} – ${dayLabel(dates.at(-1) ?? null)}`
  const covered = history?.filter(item => dates.includes(item.trading_date) && !item.partial && (!sized || item.reference_volume != null)).length
  const openDay = (next: string) => { setDay(next); setMode('intraday') }
  const dateCell = (value: string) => <th scope="row"><button type="button" className="radar-history-date-link"
    aria-label={`Xem dòng tiền trong phiên ${dayLabel(value)}`} onClick={() => openDay(value)}>{dayLabel(value)}</button></th>
  return <dialog ref={dialog} className="radar-history radar-history-sheet" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="radar-history-content">
    <div className="radar-history-top">
      <header className="radar-history-heading">
        <div><h2 id={titleId}>{title}</h2><p className="radar-meta">{exchangeLabel(row.exchange)} · <strong>{intraday ? 'Ba nhóm giá trị khớp' : groupLabel}</strong>{!intraday && methodLabel && ` · ${methodLabel}`}</p></div>
        <button type="button" className="icon-button radar-history-close" aria-label="Đóng lịch sử" onClick={onClose}><X size={19} aria-hidden="true"/></button>
      </header>
      <div className="radar-history-controls">
        <Chips label="Chế độ lịch sử" options={[[ 'daily', 'Theo phiên' ], [ 'intraday', 'Trong phiên' ]]} value={mode} onChange={setMode}/>
        {!intraday && <Chips label="Chu kỳ lịch sử" options={historyPeriods} value={period} onChange={onPeriodChange}/>}
      </div>
    </div>
    {intraday ? <RadarReplay exchange={row.exchange} symbol={row.symbol} day={day} recentDays={recentDays} onDayChange={setDay}/> : <>
      <p className="radar-meta">{periodLabel} · {sized ? 'Đã đối soát' : 'Có dữ liệu'} {covered ?? '—'}/{dates.length} phiên</p>
      {loading && <p className="radar-meta" role="status">Đang tải lịch sử…</p>}
      {error && <p className="radar-meta" role="alert">Không tải được lịch sử. <button type="button" className="secondary-button" onClick={retry}>Thử lại</button></p>}
      {!loading && !error && history?.length === 0 && <p className="radar-meta" role="status">Chưa có dữ liệu khi chọn khoảng phiên này.</p>}
      {dates.length > historyLimit && <p className="radar-meta">Hiển thị tối đa {historyLimit} phiên có bản ghi gần nhất.</p>}
      {history && history.length > 0 && <>
      <HistoryChart dates={dates} history={history} sized={sized} auction={auction} onOpenDay={openDay}/>
      <details className="radar-history-data"><summary>Số liệu từng phiên</summary><div className="radar-history-scroll" tabIndex={0} aria-label="Bảng lịch sử từng phiên"><table><thead><tr><th scope="col">Phiên</th>{auction
        ? <><th scope="col">Giá khớp BQ (nghìn đ)</th><th scope="col">KL khớp (CP)</th><th scope="col">GT khớp (tỷ)</th><th scope="col">Số bản ghi nguồn</th></>
        : <><th scope="col">Mua (tỷ)</th><th scope="col">Bán (tỷ)</th><th scope="col">Ròng (tỷ)</th><th scope="col">KL ròng (CP)</th>{sized && <th scope="col">Chưa rõ chiều (tỷ)</th>}</>}</tr></thead>
        <tbody>{history?.map(day => {
          if (sized && (day.partial || day.reference_volume == null)) return <tr key={day.trading_date}>
            {dateCell(day.trading_date)}<td colSpan={auction ? 4 : 5}>Thiếu băng khớp · {quantity(day.tape_volume)}/{quantity(day.reference_volume)} CP đối soát</td>
          </tr>
          if (auction) return <tr key={day.trading_date}>{dateCell(day.trading_date)}<td>{auctionPrice(day.unknown_value, day.unknown_volume)}</td><td>{quantity(day.unknown_volume)}</td><td>{billions(day.unknown_value)}</td><td>{quantity(day.trade_count)}</td></tr>
          const net = historyValue(day, sized, auction)
          const netVolume = day.buy_volume == null || day.sell_volume == null ? null : day.buy_volume - day.sell_volume
          return <tr key={day.trading_date}>{dateCell(day.trading_date)}<td>{billions(day.buy_value)}</td><td>{billions(day.sell_value)}</td><td data-direction={direction(net)}>{billions(net, true)}</td><td data-direction={direction(netVolume)}>{quantity(netVolume, true)}</td>{sized && <td>{billions(day.unknown_value)}</td>}</tr>
        })}</tbody></table></div></details></>}
    </>}
    </div>
  </dialog>
}

export function MarketFlowRadar({ authenticated, active, tradingDates }: { authenticated: boolean; active: boolean; tradingDates: string[] }) {
  const [view, setView] = useState('daily')
  const [exchange, setExchange] = useState('all')
  const [category, setCategory] = useState<string>('foreign')
  const [tapeMode, setTapeMode] = useState('continuous')
  const [period, setPeriod] = useState('1')
  const [order, setOrder] = useState('buy')
  const [rangeOpen, setRangeOpen] = useState(false)
  const [draftRange, setDraftRange] = useState({ start: '', end: '' })
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' })
  const [search, setSearch] = useState('')
  const [expandedRow, setExpandedRow] = useState('')
  const [historyRow, setHistoryRow] = useState<FlowRow | null>(null)
  const [historyPeriod, setHistoryPeriod] = useState('selection')
  const [page, setPage] = useState(0)
  const latest = tradingDates.at(-1) ?? ''
  const sized = category !== 'foreign' && category !== 'proprietary'
  const method = sized ? tapeMode : 'total'
  const auction = method === 'auction'
  const countLabel = sized ? tapeMode === 'continuous_cluster' ? 'SL cụm' : 'SL lần khớp' : 'SL lệnh'
  const earliest = tradingDates[0] ?? ''
  const rangeError = draftRange.start && draftRange.end && (draftRange.start > draftRange.end
    ? 'Ngày bắt đầu phải sớm hơn hoặc trùng ngày kết thúc.'
    : draftRange.start < earliest || draftRange.end > latest ? 'Chọn ngày trong phạm vi lịch giao dịch đã công bố.' : '')
  const dates = period === 'custom' ? tradingDates.filter(day => day >= appliedRange.start && day <= appliedRange.end)
    : period === 'ytd' ? tradingDates.filter(day => day.startsWith(latest.slice(0, 4)))
    : tradingDates.slice(-Number(period))
  const first = dates[0] ?? ''
  const last = dates.at(-1) ?? ''
  const ready = view === 'daily' && active && authenticated && Boolean(supabase && first && last)
  const searchTerm = search.trim().toUpperCase()
  const orderOptions = sized ? tapeMode === 'auction' ? [sizeOrder] : [...orders, sizeOrder] : [...orders, category === 'foreign' ? ['ownership', 'Sở hữu (%)'] as const : ['holdings', 'SL nắm giữ'] as const]
  const query = useQuery({
    queryKey: ['market-radar-dashboard', first, last, exchange, category, method, order, searchTerm], enabled: ready, staleTime: 60_000,
    queryFn: async () => {
      const args = { p_start: first, p_end: last, p_exchange: exchange, p_category: category, p_search: searchTerm }
      const { data, error } = auction ? await supabase!.rpc('market_radar_auction', args)
        : await supabase!.rpc('market_radar_dashboard_v2', { ...args, p_order: order, p_mode: method })
      if (error) throw error
      return data as Dashboard
    },
  })
  const reportFailures = useQuery({
    queryKey: ['market-radar-report-failures', first, last, category], enabled: ready && !sized, staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase!.from('market_radar_source_status').select('trading_date,exchange')
        .eq('category', category).eq('status', 'failed').gte('trading_date', first).lte('trading_date', last).abortSignal(signal)
      if (error) throw error
      return data as { trading_date: string; exchange: string }[]
    },
  })
  const rows = query.data?.rows ?? []
  const maxPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
  const currentPage = Math.min(page, maxPage)
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const historyDates = historyPeriod === 'selection' ? dates : tradingDates.filter(day => day <= last).slice(-Number(historyPeriod))
  const historyStart = historyDates[0]
  const history = useQuery({
    queryKey: ['market-radar-history', historyRow && rowKey(historyRow), category, method, historyStart, last], enabled: ready && Boolean(historyRow && historyStart), staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase!.from('market_radar_daily').select('trading_date,buy_value,sell_value,buy_volume,sell_volume,unknown_value,unknown_volume,trade_count,partial,tape_volume,reference_volume')
        .eq('exchange', historyRow!.exchange).eq('symbol', historyRow!.symbol).eq('category', category).eq('method', method)
        .gte('trading_date', historyStart).lte('trading_date', last).order('trading_date', { ascending: false }).limit(historyLimit).abortSignal(signal)
      if (error) throw error
      return data as FlowDay[]
    },
  })
  const scope = exchanges.filter(([id]) => id !== 'all' && (exchange === 'all' || exchange === id))
  function resetRows() { setPage(0); setExpandedRow(''); setHistoryRow(null) }
  function openHistory(row: FlowRow) {
    setHistoryPeriod(dates.length > 1 ? 'selection' : '20')
    setHistoryRow(row)
  }
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
      <div className="radar-title"><span><Radar size={22} aria-hidden="true"/></span><div><h2 id="market-radar-title">Radar dòng tiền</h2><p>HOSE, HNX và UPCoM</p></div></div>
      <Chips label="Chế độ Radar" options={[[ 'daily', 'Theo phiên' ], [ 'live', 'Trong phiên' ]]} value={view} onChange={next => { setView(next); resetRows() }}/>
      {view === 'daily' && <button type="button" className="secondary-button radar-refresh" disabled={!ready || query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} aria-hidden="true"/> Làm mới</button>}
    </header>

    {view === 'live' ? <LiveRadar authenticated={authenticated} active={active}/> : <>
    <div className="radar-categories" role="group" aria-label="Nhóm dòng tiền">{categories.map(({ id, label, note, icon: Icon, tone }) =>
      <button key={id} type="button" data-tone={tone} aria-pressed={category === id} onClick={() => { setCategory(id); setOrder(id !== 'foreign' && id !== 'proprietary' && tapeMode === 'auction' ? 'size' : 'buy'); resetRows() }}>
        <span className="radar-category-icon"><Icon size={17} aria-hidden="true"/></span><span><strong>{label}</strong><small>{['foreign', 'proprietary'].includes(id) || tapeMode !== 'continuous_cluster' ? note : 'Giá trị mỗi cụm khớp'}</small></span>
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
      {sized && <div className="radar-filter-group"><Chips label="Cách tính khớp lệnh" options={tapeModes} value={tapeMode} onChange={value => { setTapeMode(value); setOrder(value === 'auction' ? 'size' : 'buy'); resetRows() }}/></div>}
      <div className="radar-filter-group"><span className="radar-filter-label">Xếp hạng</span><Chips label="Xếp hạng" options={orderOptions} value={order} onChange={value => { setOrder(value); resetRows() }}/></div>
    </div>

    {!auction && <dl className="radar-summary" aria-label="Tổng hợp theo nhóm, sàn và chu kỳ">
      <div className="radar-stat" data-direction={direction(query.data?.net_value)}><dt>Tổng mua ròng</dt><dd>{billions(query.data?.net_value, true)} <small>tỷ</small></dd></div>
      <div className="radar-stat" data-direction={direction(query.data?.net_volume)}><dt>Tổng khối lượng ròng</dt><dd>{quantity(query.data?.net_volume, true)} <small>CP</small></dd></div>
      <LeaderCard title="Gom ròng mạnh nhất" leader={query.data?.strongest_buy} side={1}/>
      <LeaderCard title="Xả ròng mạnh nhất" leader={query.data?.strongest_sell} side={-1}/>
    </dl>}

    <div className="radar-table-heading"><div><h3>{searchTerm ? 'Kết quả tìm mã' : `Top ${rows.length || 20} cổ phiếu`}</h3>
      {last && <p className="radar-meta">{first === last ? dayLabel(last) : `${dayLabel(first)} – ${dayLabel(last)}`} · {dates.length} phiên{sized && (tapeMode === 'auction' ? ' · Khớp định kỳ' : ' · Khớp lệnh liên tục')}</p>}</div>
      {query.data && <div className="radar-coverage" aria-label="Độ phủ theo sàn">{scope.map(([id, name]) => {
        const item = query.data.coverage.find(entry => entry.exchange === id)
        const failures = reportFailures.data?.filter(entry => entry.exchange === id && dates.includes(entry.trading_date)).length ?? 0
        return <span key={id} title={item?.latest ? `Phiên mới nhất có dữ liệu ${dayLabel(item.latest)}` : 'Chưa có dữ liệu'}>{name} <b>{item?.observed ?? 0}/{dates.length} phiên</b>{sized && item?.universe != null ? <small> · {item.ready}/{item.universe} mã đủ kỳ đối soát</small> : item?.partial && <small> · Mẫu giới hạn</small>}{failures > 0 && <small> · {failures} phiên lỗi nguồn</small>}</span>
      })}</div>}
    </div>
    {query.isError && <p className="market-error" role="alert">Không tải được Radar. <button type="button" className="secondary-button" onClick={() => void query.refetch()}>Thử lại</button></p>}
    {!rows.length && !query.isError && <p className="market-empty" role="status">{query.isFetching ? 'Đang tải xếp hạng…' : !dates.length && period === 'custom' ? 'Khoảng ngày đã chọn chưa có phiên giao dịch.' : query.data?.coverage.length ? 'Không có mã phù hợp với bộ lọc.' : 'Chưa đủ dữ liệu cho lựa chọn này.'}</p>}

    {visible.length > 0 && <>
      <div className="radar-table-frame"><table className="market-radar-table">
        <thead><tr><th scope="col">Mã / Sàn</th>{rowMetrics(visible[0], countLabel, auction).map(metric =>
          <th key={metric.label} scope="col" className={metric.primary ? '' : 'radar-desktop-cell'}>{metric.label}{metric.unit && <span>{metric.unit}</span>}</th>
        )}<th scope="col" className="radar-actions">Hành động</th></tr></thead>
        <tbody>{visible.map((row, index) => {
          const key = rowKey(row)
          const expanded = expandedRow === key
          const panelId = `market-radar-${row.exchange}-${row.symbol}-details`
          const historyLabel = auction ? `Xem lịch sử khớp định kỳ của ${row.symbol}` : `Xem lịch sử mua/bán ròng của ${row.symbol}`
          const metrics = rowMetrics(row, countLabel, auction)
          return <Fragment key={key}><tr className="radar-stock-row">
            <th scope="row"><button type="button" className="radar-stock" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} aria-label={`Chi tiết ${row.symbol}`} onClick={() => setExpandedRow(expanded ? '' : key)}>
              <span className="radar-rank">{row.partial && sized ? '—' : currentPage * pageSize + index + 1}</span><span className="radar-stock-label"><strong>{row.symbol}</strong><small>{exchangeLabel(row.exchange)}{sized ? ` · ${row.observed}/${row.expected ?? dates.length} phiên${row.partial ? ' · Thiếu băng khớp' : ''}` : row.partial && ' · Mẫu giới hạn'}</small></span><ChevronDown size={14} aria-hidden="true"/>
            </button>{row.company_name && <small className="radar-company" title={row.company_name}>{row.company_name}</small>}</th>
            {metrics.map(metric => <td key={metric.label} className={metric.primary ? '' : 'radar-desktop-cell'} data-direction={metric.sign}>{metric.value}</td>)}
            <td className="radar-actions"><div><button type="button" className="radar-history-action" aria-label={historyLabel} title={historyLabel}
              aria-haspopup="dialog" onClick={() => openHistory(row)}>
              <RotateCcwClock size={17} aria-hidden="true"/>
            </button></div></td>
          </tr>{expanded && <tr id={panelId} className="radar-detail-row"><td colSpan={metrics.length + 2}><RowDetails row={row} expected={row.expected ?? dates.length} sized={sized} countLabel={countLabel} auction={auction}/></td></tr>}</Fragment>
        })}</tbody>
      </table></div>
      <div className="radar-table-footer"><p className="radar-meta">{auction ? 'Giá khớp BQ tính theo khối lượng. Số bản ghi phản ánh mức gộp của Vietcap.' : '* Giá mua bình quân trong kỳ dùng để tham chiếu. Hiệu suất tính theo thị giá so với giá mua bình quân.'}</p>
        {maxPage > 0 && <nav className="radar-pages" aria-label="Trang bảng xếp hạng"><button type="button" aria-label="Trang trước" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setExpandedRow('') }}><ChevronLeft size={16}/></button><span>{currentPage + 1}/{maxPage + 1}</span><button type="button" aria-label="Trang sau" disabled={currentPage === maxPage} onClick={() => { setPage(currentPage + 1); setExpandedRow('') }}><ChevronRight size={16}/></button></nav>}
      </div>
    </>}
    <p className="radar-meta radar-scope-note">{sized ? `Top và tổng chỉ tính mã đủ phiên đã đối soát. ${tapeMode === 'continuous_cluster' ? 'Cụm gộp các lần khớp liên tiếp cùng giây, cùng giá và cùng chiều.' : tapeMode === 'auction' ? 'Khớp định kỳ chỉ có giá trị và khối lượng chưa rõ chiều.' : 'Chiều mua/bán chủ động theo nguồn băng khớp.'} Giao dịch thỏa thuận nằm ngoài phạm vi khớp lệnh.` : 'SL lệnh hiện — khi báo cáo của nhóm chỉ có số liệu mua/bán tổng hợp.'}</p>
    {ready && historyRow && <RowHistory row={historyRow} category={category} method={method} sized={sized} auction={auction}
      dates={historyDates} recentDays={tradingDates.slice(-5)} selectedDay={last} period={historyPeriod} onPeriodChange={setHistoryPeriod}
      history={history.data} loading={history.isFetching} error={history.isError} retry={() => void history.refetch()} onClose={() => setHistoryRow(null)}/>}
    </>}
  </section>
}
