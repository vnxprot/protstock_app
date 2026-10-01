import { useEffect, useMemo, useRef } from 'react'
import { ColorType, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import type { PriceBar } from '../hooks/useStockAnalysis'
import { calculateMacd } from '../lib/macd'

export function MacdPanel({ bars }: { bars: PriceBar[] }) {
  const host = useRef<HTMLDivElement>(null)
  const points = useMemo(() => calculateMacd(bars), [bars])
  const latest = points.at(-1)
  const recentCross = [...points].reverse().find(point => point.cross)
  useEffect(() => {
    if (!host.current || !points.length) return
    const element = host.current
    const light = document.documentElement.dataset.theme === 'light'
    const chart = createChart(element, {
      width: Math.max(100, element.clientWidth), height: 230,
      layout: { background: { type: ColorType.Solid, color: light ? '#fff' : '#08130f' }, textColor: light ? '#4d6658' : '#82988d' },
      grid: { vertLines: { color: light ? '#e5ece7' : '#14221c' }, horzLines: { color: light ? '#e5ece7' : '#14221c' } },
    })
    chart.addSeries(LineSeries, { color: '#5d8fff', lineWidth: 2, priceLineVisible: false }).setData(points.map(point => ({ time: point.time as any, value: point.macd })))
    chart.addSeries(LineSeries, { color: '#f3b54a', lineWidth: 2, priceLineVisible: false }).setData(points.filter(point => point.signal != null).map(point => ({ time: point.time as any, value: point.signal! })))
    chart.addSeries(HistogramSeries, { priceLineVisible: false }).setData(points.filter(point => point.histogram != null).map(point => ({ time: point.time as any, value: point.histogram!, color: point.histogram! >= 0 ? '#55b889' : '#dd6b75' })))
    chart.timeScale().fitContent()
    const observer = new ResizeObserver(() => chart.applyOptions({ width: Math.max(100, element.clientWidth) }))
    observer.observe(element)
    return () => { observer.disconnect(); chart.remove() }
  }, [points])
  return <article className="panel macd-panel"><div className="panel-title"><div><h3>MACD · nghiên cứu</h3><small>12/26/9 · toàn bộ nến ngày từ 01/01/2021</small></div><span>{latest?.histogram == null ? 'Chưa đủ dữ liệu' : latest.histogram > 0 ? 'MACD trên Signal' : latest.histogram < 0 ? 'MACD dưới Signal' : 'MACD bằng Signal'}</span></div>
    {points.length ? <><div ref={host} aria-label="Biểu đồ MACD, đường Signal và Histogram"/><p className="muted">MACD {latest?.macd.toFixed(3)} · Signal {latest?.signal?.toFixed(3) ?? '—'} · Histogram {latest?.histogram?.toFixed(3) ?? '—'}{recentCross ? ` · Giao cắt ${recentCross.cross === 'UP' ? 'tăng' : 'giảm'} gần nhất ${recentCross.time.split('-').reverse().join('/')}` : ''}</p></> : <p className="muted">Cần ít nhất 26 nến ngày đã đóng để hiển thị MACD.</p>}
  </article>
}
