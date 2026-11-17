import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ColorType, LineSeries, LineStyle, createChart, type AutoscaleInfo, type UTCTimestamp } from 'lightweight-charts'
import { formatDate } from '../lib/date'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/theme'

const bucket = 'market-radar-minute-replay'
const groups = [
  { label: '≥ 1 tỷ', tone: 'large' },
  { label: '200 tr – dưới 1 tỷ', tone: 'medium' },
  { label: '< 200 tr', tone: 'small' },
] as const
const vnTime = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('vi-VN')
type Amounts = [number, number, number, number]
type Replay = {
  start: number
  end: number
  minutes: [number, number, ...Amounts][]
  unknown: number[]
  unavailable: boolean[]
}

function cumulativeMinutes(replay: Replay) {
  const increments = new Map<number, [number, ...Amounts][]>()
  for (const [time, ...row] of replay.minutes) {
    const minute = increments.get(time) ?? []
    minute.push(row)
    increments.set(time, minute)
  }
  const totals: Amounts[] = groups.map(() => [0, 0, 0, 0])
  const timeline = new Set(increments.keys())
  for (let time = replay.start; time <= replay.end; time += 60) {
    const minuteOfDay = (time / 60 + 7 * 60) % (24 * 60)
    if (minuteOfDay <= 690 || minuteOfDay >= 780) timeline.add(time)
  }
  return [...timeline].sort((a, b) => a - b).map(time => {
    for (const [group, ...values] of increments.get(time) ?? []) {
      values.forEach((value, index) => { totals[group][index] += value })
    }
    return { time: time as UTCTimestamp, amounts: totals.map(group => [...group] as Amounts) }
  })
}

function ReplayChart({ replay }: { replay: Replay }) {
  const host = useRef<HTMLDivElement>(null)
  const theme = useTheme()
  const [active, setActive] = useState<number[]>([0, 1, 2])
  const [mode, setMode] = useState<'net' | 'sides'>('net')
  const [unit, setUnit] = useState<'value' | 'volume'>('value')
  const [cursor, setCursor] = useState<number>()
  const points = useMemo(() => cumulativeMinutes(replay), [replay])
  const visible = useMemo(() => active.filter(index => !replay.unavailable[index]), [active, replay.unavailable])
  const last = points.at(-1)
  const point = points.find(item => item.time === cursor) ?? last
  const offset = unit === 'value' ? 0 : 2
  const scale = unit === 'value' ? 1e9 : 1
  const number = unit === 'value' ? decimal : integer
  const signed = (amount: number) => `${amount > 0 ? '+' : ''}${number.format(amount / scale)}`

  useEffect(() => {
    const element = host.current
    if (!element || !visible.length) return
    const palette = getComputedStyle(element)
    const color = (name: string) => palette.getPropertyValue(name).trim()
    const labelTime = (time: unknown) => typeof time === 'number' ? vnTime.format(time * 1000) : ''
    const chart = createChart(element, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: color('--surface') }, textColor: color('--muted') },
      grid: { vertLines: { visible: false }, horzLines: { color: color('--line') } },
      localization: { timeFormatter: labelTime, priceFormatter: (value: number) => number.format(value) },
      timeScale: { timeVisible: true, secondsVisible: false, tickMarkFormatter: labelTime, borderColor: color('--line') },
    })
    for (const index of visible) {
      const series = chart.addSeries(LineSeries, {
        color: color(`--replay-${groups[index].tone}`), lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const info = original()
          if (!info?.priceRange) return info
          return { ...info, priceRange: {
            minValue: Math.min(0, info.priceRange.minValue), maxValue: Math.max(0, info.priceRange.maxValue),
          } }
        },
      })
      series.setData(points.map(({ time, amounts }) => ({
        time, value: (amounts[index][offset] - (mode === 'net' ? amounts[index][offset + 1] : 0)) / scale,
      })))
      if (index === visible[0]) series.createPriceLine({ price: 0, color: color('--line-bright'), lineWidth: 1, axisLabelVisible: false })
      if (mode === 'sides') {
        const sell = chart.addSeries(LineSeries, { color: color('--red'), lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
        sell.setData(points.map(({ time, amounts }) => ({ time, value: amounts[index][offset + 1] / scale })))
      }
    }
    chart.subscribeCrosshairMove(event => setCursor(typeof event.time === 'number' ? event.time : undefined))
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [mode, number, offset, points, scale, theme, visible])

  return <>
    <div className="radar-replay-groups" role="group" aria-label="Nhóm giá trị khớp">
      {groups.map(({ label, tone }, index) => {
        const unavailable = replay.unavailable[index]
        const net = last ? last.amounts[index][offset] - last.amounts[index][offset + 1] : 0
        return <button key={tone} type="button" data-group={tone} aria-pressed={!unavailable && active.includes(index)} disabled={unavailable} onClick={() => {
          if (mode === 'sides') setActive([index])
          else if (!active.includes(index)) setActive([...active, index])
          else if (visible.length > 1) setActive(active.filter(group => group !== index))
          setCursor(undefined)
        }}><span>{label}</span><strong data-direction={Math.sign(net)}>{unavailable ? '—' : signed(net)}</strong></button>
      })}
    </div>
    <div className="radar-history-controls">
      <div className="radar-chips" role="group" aria-label="Hiển thị dòng tiền">
        <button type="button" aria-pressed={mode === 'net'} onClick={() => { setMode('net'); setActive([0, 1, 2]) }}>Ròng</button>
        <button type="button" aria-pressed={mode === 'sides'} disabled={!visible.length} onClick={() => { setActive(visible.slice(0, 1)); setMode('sides') }}>Mua &amp; Bán</button>
      </div>
      <div className="radar-chips" role="group" aria-label="Đơn vị dòng tiền">
        <button type="button" aria-pressed={unit === 'value'} onClick={() => setUnit('value')}>Giá trị (tỷ)</button>
        <button type="button" aria-pressed={unit === 'volume'} onClick={() => setUnit('volume')}>Khối lượng (CP)</button>
      </div>
    </div>
    {visible.length > 0 && <div className="radar-history-chart-wrap">
      <div className="radar-replay-readout"><b>{point ? vnTime.format(point.time * 1000) : '—'}</b>{point && visible.map(index => {
        const [buy, sell] = point.amounts[index].slice(offset, offset + 2)
        return <span key={index}>{groups[index].label} <strong>{mode === 'net' ? signed(buy - sell) : `Mua ${number.format(buy / scale)} · Bán ${number.format(sell / scale)}`}</strong></span>
      })}</div>
      <div ref={host} className="radar-history-chart" role="img" aria-label="Diễn biến mua bán chủ động tích lũy theo phút"/>
    </div>}
    {replay.unknown.some(Boolean) && <p className="radar-meta">Khớp liên tục chưa rõ chiều {decimal.format(replay.unknown.reduce((sum, value) => sum + value, 0) / 1e9)} tỷ đồng.</p>}
    <p className="radar-meta">VCI · Từng lần khớp liên tục · Giá trị cuối phiên ở các thẻ</p>
  </>
}

export function RadarReplay({ exchange, symbol, day, recentDays, onDayChange }: {
  exchange: string; symbol: string; day: string; recentDays: string[]; onDayChange: (day: string) => void
}) {
  const path = `${exchange}/${symbol}`
  const store = supabase!.storage.from(bucket)
  const catalog = useQuery({
    queryKey: ['market-radar-replay-days', path], staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await store.list(path, { limit: 30, sortBy: { column: 'name', order: 'desc' } })
      if (error) throw error
      return data.filter(file => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(file.name)).map(file => file.name.slice(0, 10))
    },
  })
  const available = catalog.data?.includes(day)
  const replay = useQuery({
    queryKey: ['market-radar-replay', path, day], enabled: Boolean(available), staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await store.download(`${path}/${day}.json.gz`)
      if (error) throw error
      const stream = data.stream().pipeThrough(new DecompressionStream('gzip'))
      return await new Response(stream).json() as Replay
    },
  })
  const daily = useQuery({
    queryKey: ['market-radar-replay-tape-status', exchange, symbol, day], enabled: Boolean(day), staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('market_radar_daily')
        .select('category,partial,tape_reason,tape_volume,reference_volume,source,buy_value,sell_value,buy_volume,sell_volume,unknown_value')
        .eq('exchange', exchange).eq('symbol', symbol).eq('trading_date', day).eq('method', 'continuous')
      if (error) throw error
      return data
    },
  })
  const options = [...new Set([day, ...recentDays, ...(catalog.data ?? [])].filter(Boolean))].sort().reverse()
  const status = daily.data?.find(row => row.category === 'large')
  const snapshot = replay.data
  const matchesDaily = useMemo(() => {
    const dailyRows = daily.data
    if (!snapshot || !dailyRows) return false
    const last = cumulativeMinutes(snapshot).at(-1)
    return groups.every(({ tone }, index) => {
      const row = dailyRows.find(item => item.category === tone)
      if (!row?.source?.startsWith('Vietcap') || row.partial || row.reference_volume == null || !last) return false
      const official = [row.buy_value, row.sell_value, row.buy_volume, row.sell_volume]
      return (row.unknown_value ?? 0) === snapshot.unknown[index] &&
        (snapshot.unavailable[index] ? official.every(value => value == null) : official.every((value, field) => value === last.amounts[index][field]))
    })
  }, [daily.data, snapshot])
  return <>
    <label className="radar-replay-date">
      <span>Ngày giao dịch</span>
      <select value={day} onChange={event => onDayChange(event.target.value)}>
        {options.map(date => <option key={date} value={date}>{formatDate(date)}{catalog.data?.includes(date) ? ' · Có biểu đồ' : ''}</option>)}
      </select>
    </label>
    {(catalog.isPending || daily.isPending || (available && replay.isPending)) ? <p className="radar-meta" role="status">Đang tải dữ liệu trong phiên…</p>
      : catalog.isError || daily.isError || replay.isError ? <p className="radar-meta" role="alert">Không tải được diễn biến trong phiên. <button type="button" className="secondary-button" onClick={() => {
        void catalog.refetch(); void daily.refetch()
        if (available) void replay.refetch()
      }}>Thử lại</button></p>
      : status?.partial ? <p className="radar-meta">Chưa đủ băng khớp · {integer.format(status.tape_volume ?? 0)}/{status.reference_volume == null ? '—' : integer.format(status.reference_volume)} CP đối soát.
        {status.tape_reason === 'missing_reference' && ' Đang thiếu khối lượng tham chiếu.'}
        {status.tape_reason === 'volume_mismatch' && ' Khối lượng VCI lệch tham chiếu.'}</p>
      : status?.source?.startsWith('SSI WebSocket') ? <p className="radar-meta">Phiên đã đối soát bằng SSI. Chưa có biểu đồ phút từ cùng nguồn.</p>
      : available && snapshot && matchesDaily ? <ReplayChart key={day} replay={snapshot}/>
      : available ? <p className="radar-meta">Bản xem lại đang chờ đồng bộ với số liệu cuối phiên.</p>
      : <p className="radar-meta">Chưa có bản xem lại theo phút cho ngày này.</p>}
  </>
}
