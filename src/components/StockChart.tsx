import { useEffect, useRef } from 'react'
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import type { PatternInstance, PriceBar, PriceZone } from '../hooks/useStockAnalysis'

type Indicators = { ma20: boolean; ma50: boolean; ma200: boolean; bollinger: boolean }

function average(values: PriceBar[], length: number) {
  return values.flatMap((bar, index) => index + 1 < length ? [] : [{
    time: bar.trading_date,
    value: values.slice(index + 1 - length, index + 1).reduce((sum, item) => sum + Number(item.close), 0) / length,
  }])
}

function bollinger(values: PriceBar[], upper: boolean) {
  return values.flatMap((bar, index) => {
    if (index < 19) return []
    const slice = values.slice(index - 19, index + 1).map(item => Number(item.close))
    const mean = slice.reduce((sum, value) => sum + value, 0) / 20
    const deviation = Math.sqrt(slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 20)
    return [{ time: bar.trading_date, value: mean + (upper ? 2 : -2) * deviation }]
  })
}

function chartPalette() {
  const light = document.documentElement.dataset.theme === 'light'
  return light
    ? { background: '#ffffff', text: '#4d6658', grid: '#e5ece7', border: '#afc5b7', up: '#08754d', down: '#b4233b', volumeUp: '#08754d55', volumeDown: '#b4233b55', ma20: '#466900', ma50: '#2463c4', ma200: '#8251b7', band: '#08754d88' }
    : { background: '#08130f', text: '#82988d', grid: '#14221c', border: '#26372f', up: '#55e6b1', down: '#ff7373', volumeUp: '#55e6b133', volumeDown: '#ff737333', ma20: '#d7ff52', ma50: '#5d8fff', ma200: '#bd7dff', band: '#55e6b166' }
}

function normalizedBars(bars: PriceBar[]) {
  const byDate = new Map<string, PriceBar>()
  bars.forEach(bar => {
    const values = [bar.open, bar.high, bar.low, bar.close]
    if (bar.trading_date && values.every(value => Number.isFinite(Number(value)))) byDate.set(bar.trading_date, bar)
  })
  return [...byDate.values()].sort((left, right) => left.trading_date.localeCompare(right.trading_date))
}

export function StockChart({ bars, zones: _zones = [], patterns: _patterns = [], indicators, paneLabel }: {
  bars: PriceBar[]
  zones?: PriceZone[]
  patterns?: PatternInstance[]
  indicators: Indicators
  syncGroup?: string
  paneId?: string
  paneLabel?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = ref.current
    const data = normalizedBars(bars)
    if (!host || !data.length) return

    const palette = chartPalette()
    const height = innerWidth <= 760 ? 310 : 430
    const chart = createChart(host, {
      width: Math.max(1, Math.round(host.getBoundingClientRect().width)),
      height,
      layout: { fontFamily: 'Inter, sans-serif', fontSize: 12, background: { type: ColorType.Solid, color: palette.background }, textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border, timeVisible: false },
    })
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: palette.up, downColor: palette.down, borderVisible: false, wickUpColor: palette.up, wickDownColor: palette.down,
    })
    candles.setData(data.map(bar => ({ time: bar.trading_date as any, open: +bar.open, high: +bar.high, low: +bar.low, close: +bar.close })))
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' })
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } })
    volume.setData(data.map(bar => ({ time: bar.trading_date as any, value: +bar.volume, color: +bar.close >= +bar.open ? palette.volumeUp : palette.volumeDown })))

    const lines = [
      indicators.ma20 && { data: average(data, 20), color: palette.ma20 },
      indicators.ma50 && { data: average(data, 50), color: palette.ma50 },
      indicators.ma200 && { data: average(data, 200), color: palette.ma200 },
      indicators.bollinger && { data: bollinger(data, true), color: palette.band },
      indicators.bollinger && { data: bollinger(data, false), color: palette.band },
    ].filter(Boolean) as { data: { time: string; value: number }[]; color: string }[]
    const chartLines = lines.map(item => {
      const line = chart.addSeries(LineSeries, { color: item.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
      line.setData(item.data as any)
      return line
    })
    chart.timeScale().fitContent()

    const recolor = () => {
      const next = chartPalette()
      chart.applyOptions({ layout: { background: { type: ColorType.Solid, color: next.background }, textColor: next.text }, grid: { vertLines: { color: next.grid }, horzLines: { color: next.grid } }, rightPriceScale: { borderColor: next.border }, timeScale: { borderColor: next.border } })
      candles.applyOptions({ upColor: next.up, downColor: next.down, wickUpColor: next.up, wickDownColor: next.down })
      volume.setData(data.map(bar => ({ time: bar.trading_date as any, value: +bar.volume, color: +bar.close >= +bar.open ? next.volumeUp : next.volumeDown })))
      chartLines.forEach((line, index) => line.applyOptions({ color: [next.ma20, next.ma50, next.ma200, next.band, next.band][index] }))
    }
    let lastWidth = 0
    const resize = () => {
      const width = Math.round(host.getBoundingClientRect().width)
      if (width > 1 && width !== lastWidth) {
        lastWidth = width
        chart.resize(width, height)
      }
    }
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(resize)
    })
    observer.observe(host)
    window.addEventListener('resize', resize)
    window.addEventListener('protstock:theme-change', recolor)
    resize()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('protstock:theme-change', recolor)
      chart.remove()
    }
  }, [bars, indicators])

  return <div className="stock-chart" ref={ref} style={{ height: innerWidth <= 760 ? 310 : 430 }} aria-label={`${paneLabel ?? 'Biểu đồ'} nến, khối lượng và đường trung bình`} />
}
