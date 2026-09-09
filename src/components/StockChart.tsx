import { useEffect, useRef } from 'react'
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import type { PriceBar } from '../hooks/useStockAnalysis'

function movingAverage(values: PriceBar[], length: number) {
  return values.flatMap((bar, index) => index + 1 < length ? [] : [{
    time: bar.trading_date,
    value: values.slice(index + 1 - length, index + 1).reduce((sum, item) => sum + Number(item.close), 0) / length,
  }])
}

export function StockChart({ bars }: { bars: PriceBar[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !bars.length) return
    const chart = createChart(ref.current, {
      height: 430,
      layout: { background: { type: ColorType.Solid, color: '#0b1713' }, textColor: '#82988d' },
      grid: { vertLines: { color: '#17251f' }, horzLines: { color: '#17251f' } },
      rightPriceScale: { borderColor: '#26372f' }, timeScale: { borderColor: '#26372f' },
    })
    const candles = chart.addSeries(CandlestickSeries, { upColor: '#55e6b1', downColor: '#ff7c7c', borderVisible: false, wickUpColor: '#55e6b1', wickDownColor: '#ff7c7c' })
    candles.setData(bars.map(bar => ({ time: bar.trading_date, open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close) })))
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })
    volume.setData(bars.map(bar => ({ time: bar.trading_date, value: Number(bar.volume), color: Number(bar.close) >= Number(bar.open) ? '#55e6b144' : '#ff7c7c44' })))
    const ma20 = chart.addSeries(LineSeries, { color: '#d7ff52', lineWidth: 2, priceLineVisible: false })
    const ma50 = chart.addSeries(LineSeries, { color: '#63a8ff', lineWidth: 2, priceLineVisible: false })
    ma20.setData(movingAverage(bars, 20))
    ma50.setData(movingAverage(bars, 50))
    chart.timeScale().fitContent()
    const observer = new ResizeObserver(entries => chart.applyOptions({ width: entries[0].contentRect.width }))
    observer.observe(ref.current)
    return () => { observer.disconnect(); chart.remove() }
  }, [bars])
  return <div className="stock-chart" ref={ref} aria-label="Biểu đồ nến, khối lượng và đường trung bình" />
}

