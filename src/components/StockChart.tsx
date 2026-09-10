import { useEffect, useMemo, useRef } from 'react'
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import type { PatternInstance, PriceBar, PriceZone } from '../hooks/useStockAnalysis'

type Indicators = { ma20: boolean; ma50: boolean; ma200: boolean; bollinger: boolean }
function average(values: PriceBar[], length: number) { return values.flatMap((bar, i) => i + 1 < length ? [] : [{ time: bar.trading_date, value: values.slice(i + 1 - length, i + 1).reduce((sum, item) => sum + Number(item.close), 0) / length }]) }
function bollinger(values: PriceBar[], upper: boolean) { return values.flatMap((bar, i) => { if (i < 19) return []; const slice = values.slice(i - 19, i + 1).map(x => Number(x.close)); const mean = slice.reduce((a,b) => a+b,0) / 20; const sd = Math.sqrt(slice.reduce((a,b) => a+(b-mean)**2,0)/20); return [{time:bar.trading_date,value:mean+(upper?2:-2)*sd}] }) }
const patternNames: Record<string,string> = { ACCUMULATION_BASE:'Nền tích lũy',DOUBLE_BOTTOM:'Hai đáy',DOUBLE_TOP:'Hai đỉnh',ASCENDING_TRIANGLE:'Tam giác tăng',DESCENDING_TRIANGLE:'Tam giác giảm',SYMMETRICAL_TRIANGLE:'Tam giác cân',BULL_FLAG:'Cờ tăng',BEAR_FLAG:'Cờ giảm' }

export function StockChart({ bars, zones = [], patterns = [], indicators }: { bars: PriceBar[]; zones?: PriceZone[]; patterns?: PatternInstance[]; indicators: Indicators }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || !bars.length) return
    const chart = createChart(ref.current, { height: innerWidth <= 760 ? 310 : 430, layout:{background:{type:ColorType.Solid,color:'#08130f'},textColor:'#82988d'},grid:{vertLines:{color:'#14221c'},horzLines:{color:'#14221c'}},rightPriceScale:{borderColor:'#26372f'},timeScale:{borderColor:'#26372f',timeVisible:false} })
    const candles = chart.addSeries(CandlestickSeries,{upColor:'#55e6b1',downColor:'#ff7373',borderVisible:false,wickUpColor:'#55e6b1',wickDownColor:'#ff7373'}); candles.setData(bars.map(b => ({time:b.trading_date,open:+b.open,high:+b.high,low:+b.low,close:+b.close})))
    const volume = chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:''}); volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}}); volume.setData(bars.map(b => ({time:b.trading_date,value:+b.volume,color:+b.close>=+b.open?'#55e6b133':'#ff737333'})))
    const lines = [
      indicators.ma20 && {data:average(bars,20),color:'#d7ff52'}, indicators.ma50 && {data:average(bars,50),color:'#5d8fff'}, indicators.ma200 && {data:average(bars,200),color:'#bd7dff'},
      indicators.bollinger && {data:bollinger(bars,true),color:'#55e6b166'}, indicators.bollinger && {data:bollinger(bars,false),color:'#55e6b166'},
    ].filter(Boolean) as {data:any[];color:string}[]
    lines.forEach(item => { const line=chart.addSeries(LineSeries,{color:item.color,lineWidth:2,priceLineVisible:false,lastValueVisible:false}); line.setData(item.data) })
    chart.timeScale().fitContent(); const observer=new ResizeObserver(e => chart.applyOptions({width:e[0].contentRect.width})); observer.observe(ref.current); return()=>{observer.disconnect();chart.remove()}
  },[bars,indicators])
  const levels = useMemo(() => { const high=Math.max(...bars.map(b=>+b.high)); const low=Math.min(...bars.map(b=>+b.low)); return { high, low, span:Math.max(high-low,1) } },[bars])
  return <div className="stock-chart-wrap"><div className="stock-chart" ref={ref}/><div className="chart-overlay" aria-hidden="true">{zones.slice(0,4).map(zone => { const top=(levels.high-+zone.upper_price)/levels.span*78+5; const height=Math.max((+zone.upper_price-+zone.lower_price)/levels.span*78,3); return <span key={zone.id} className={`zone-band ${zone.zone_type.toLowerCase()}`} style={{top:`${Math.max(4,Math.min(top,86))}%`,height:`${height}%`}}>{zone.zone_type==='SUPPORT'?'Hỗ trợ':'Kháng cự'} · {zone.touches} chạm</span> })}{patterns.slice(0,3).map(pattern => { const start=Math.max(0,bars.findIndex(b=>b.trading_date>=pattern.start_date)); const end=Math.max(start+1,bars.findIndex(b=>b.trading_date>=pattern.end_date)); return <span className="pattern-box" key={pattern.id} style={{left:`${5+start/Math.max(bars.length,1)*86}%`,width:`${Math.max(12,(end-start)/Math.max(bars.length,1)*86)}%`,top:`${18+(pattern.quality_score%4)*10}%`,height:'28%'}}>{patternNames[pattern.pattern_type]??pattern.pattern_type} · {Math.round(pattern.quality_score)}</span>})}</div></div>
}
