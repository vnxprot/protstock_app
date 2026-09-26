import { useEffect, useRef, useState } from 'react'
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, LineStyle, createChart } from 'lightweight-charts'
import type { PatternInstance, PriceBar, PriceZone } from '../hooks/useStockAnalysis'

type Indicators = { ma20: boolean; ma50: boolean; ma200: boolean; bollinger: boolean }
type PatternOverlay = PatternInstance & { left: number; width: number; top: number; height: number }
function average(values: PriceBar[], length: number) { return values.flatMap((bar,i)=>i+1<length?[]:[{time:bar.trading_date,value:values.slice(i+1-length,i+1).reduce((sum,item)=>sum+Number(item.close),0)/length}]) }
function bollinger(values: PriceBar[], upper:boolean) { return values.flatMap((bar,i)=>{if(i<19)return[];const slice=values.slice(i-19,i+1).map(x=>Number(x.close));const mean=slice.reduce((a,b)=>a+b,0)/20;const sd=Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/20);return[{time:bar.trading_date,value:mean+(upper?2:-2)*sd}]}) }
const patternNames:Record<string,string>={ACCUMULATION_BASE:'Nền tích lũy',DOUBLE_BOTTOM:'Hai đáy',DOUBLE_TOP:'Hai đỉnh',ASCENDING_TRIANGLE:'Tam giác tăng',DESCENDING_TRIANGLE:'Tam giác giảm',SYMMETRICAL_TRIANGLE:'Tam giác cân',BULL_FLAG:'Cờ tăng',BEAR_FLAG:'Cờ giảm'}

function chartPalette() {
  const light = document.documentElement.dataset.theme === 'light'
  return light
    ? { background: '#ffffff', text: '#4d6658', grid: '#e5ece7', border: '#afc5b7', up: '#08754d', down: '#b4233b', volumeUp: '#08754d55', volumeDown: '#b4233b55', ma20: '#466900', ma50: '#2463c4', ma200: '#8251b7', band: '#08754d88' }
    : { background: '#08130f', text: '#82988d', grid: '#14221c', border: '#26372f', up: '#55e6b1', down: '#ff7373', volumeUp: '#55e6b133', volumeDown: '#ff737333', ma20: '#d7ff52', ma50: '#5d8fff', ma200: '#bd7dff', band: '#55e6b166' }
}

type ChartSyncDetail = { group: string; source: string; trading_date: string }

export function StockChart({bars,zones=[],patterns=[],indicators,syncGroup='analysis',paneId='D',paneLabel}:{bars:PriceBar[];zones?:PriceZone[];patterns?:PatternInstance[];indicators:Indicators;syncGroup?:string;paneId?:string;paneLabel?:string}) {
  const ref=useRef<HTMLDivElement>(null); const [patternOverlays,setPatternOverlays]=useState<PatternOverlay[]>([]); const [crosshairX,setCrosshairX]=useState<number|null>(null); const [touchLocked,setTouchLocked]=useState(true)
  useEffect(()=>{if(!ref.current||!bars.length)return; const host=ref.current; const palette=chartPalette(); const initialWidth=Math.floor(host.getBoundingClientRect().width); const chart=createChart(host,{...(initialWidth>1?{width:initialWidth}:{}),height:innerWidth<=760?310:430,layout:{fontFamily:'Inter, sans-serif',fontSize:12,background:{type:ColorType.Solid,color:palette.background},textColor:palette.text},grid:{vertLines:{color:palette.grid},horzLines:{color:palette.grid}},rightPriceScale:{borderColor:palette.border},timeScale:{borderColor:palette.border,timeVisible:false}}); const candles=chart.addSeries(CandlestickSeries,{upColor:palette.up,downColor:palette.down,borderVisible:false,wickUpColor:palette.up,wickDownColor:palette.down}); candles.setData(bars.map(b=>({time:b.trading_date as any,open:+b.open,high:+b.high,low:+b.low,close:+b.close}))); const volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:''});volume.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0}});volume.setData(bars.map(b=>({time:b.trading_date as any,value:+b.volume,color:+b.close>=+b.open?palette.volumeUp:palette.volumeDown}))); const lines=[indicators.ma20&&{data:average(bars,20),color:palette.ma20},indicators.ma50&&{data:average(bars,50),color:palette.ma50},indicators.ma200&&{data:average(bars,200),color:palette.ma200},indicators.bollinger&&{data:bollinger(bars,true),color:palette.band},indicators.bollinger&&{data:bollinger(bars,false),color:palette.band}].filter(Boolean) as {data:any[];color:string}[]; const chartLines=lines.map(item=>{const line=chart.addSeries(LineSeries,{color:item.color,lineWidth:2,priceLineVisible:false,lastValueVisible:false});line.setData(item.data);return{line,color:item.color} }); chart.timeScale().fitContent()
    // Use the chart's own price lines so levels remain anchored to the price
    // scale while zooming, scrolling, resizing, and switching timeframes.
    // The detailed ranges remain in ZoneMap below; only the closest level of
    // each kind is shown here to avoid a wall of overlapping shaded bands.
    const lastClose = Number(bars[bars.length - 1].close)
    const validZones = zones.filter(zone => {
      const lower = Number(zone.lower_price)
      const upper = Number(zone.upper_price)
      return Number.isFinite(lower) && Number.isFinite(upper) && lower > 0 && upper >= lower
        && lower / lastClose > 0.4 && upper / lastClose < 2.5
    })
    const linePrice = (zone: PriceZone, kind: PriceZone['zone_type']) => kind === 'SUPPORT'
      ? Number(zone.upper_price <= lastClose ? zone.upper_price : zone.lower_price)
      : Number(zone.lower_price >= lastClose ? zone.lower_price : zone.upper_price)
    const closest = (kind: PriceZone['zone_type']) => validZones
      .filter(zone => zone.zone_type === kind && (kind === 'SUPPORT'
        ? Number(zone.lower_price) <= lastClose : Number(zone.upper_price) >= lastClose))
      .sort((a, b) => Math.abs(linePrice(a, kind) - lastClose)
        - Math.abs(linePrice(b, kind) - lastClose))[0]
    const zoneLines = (['SUPPORT', 'RESISTANCE'] as const).flatMap(kind => {
      const zone = closest(kind)
      if (!zone) return []
      const price = linePrice(zone, kind)
      const line = candles.createPriceLine({ price, color: kind === 'SUPPORT' ? palette.up : palette.down,
        lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,
        title: kind === 'SUPPORT' ? 'Hỗ trợ' : 'Kháng cự' })
      return [{ kind, line }]
    })
    // The three-pane layout has a shorter drawing area than the single chart.
    if (host.closest('.multi-chart-pane')) chart.applyOptions({ height: innerWidth <= 1050 ? 300 : 280 })
    // Recolor existing series instead of rebuilding the chart, preserving zoom/scroll.
    const recolor=()=>{const next=chartPalette();chart.applyOptions({layout:{background:{type:ColorType.Solid,color:next.background},textColor:next.text},grid:{vertLines:{color:next.grid},horzLines:{color:next.grid}},rightPriceScale:{borderColor:next.border},timeScale:{borderColor:next.border}});candles.applyOptions({upColor:next.up,downColor:next.down,wickUpColor:next.up,wickDownColor:next.down});volume.setData(bars.map(b=>({time:b.trading_date as any,value:+b.volume,color:+b.close>=+b.open?next.volumeUp:next.volumeDown})));const colors:Record<string,string>={[palette.ma20]:next.ma20,[palette.ma50]:next.ma50,[palette.ma200]:next.ma200,[palette.band]:next.band};chartLines.forEach(({line,color})=>line.applyOptions({color:colors[color]}))}
    const recolorZones=()=>{const next=chartPalette();zoneLines.forEach(({kind,line})=>line.applyOptions({color:kind==='SUPPORT'?next.up:next.down}))}
    window.addEventListener('protstock:theme-change',recolor)
    window.addEventListener('protstock:theme-change',recolorZones)
    let frame=0
    let resizeFrame=0
    const syncPatterns=()=>{
      cancelAnimationFrame(frame)
      frame=requestAnimationFrame(()=>{
        const height=host.clientHeight
        const width=host.clientWidth
        const nextPatterns=patterns.flatMap(pattern=>{
          const start=chart.timeScale().timeToCoordinate(pattern.start_date as any)
          const end=chart.timeScale().timeToCoordinate(pattern.end_date as any)
          const values=bars.filter(b=>b.trading_date>=pattern.start_date&&b.trading_date<=pattern.end_date).flatMap(b=>[+b.high,+b.low])
          if(start==null||end==null||!values.length)return[]
          const yTop=candles.priceToCoordinate(Math.max(...values))
          const yBottom=candles.priceToCoordinate(Math.min(...values))
          if(yTop==null||yBottom==null)return[]
          const left=Math.max(0,Math.min(start,end))
          const right=Math.min(width,Math.max(start,end))
          const top=Math.max(0,Math.min(yTop,yBottom))
          const bottom=Math.min(height,Math.max(yTop,yBottom))
          if(right<=0||left>=width||bottom<=0||top>=height)return[]
          return[{...pattern,left,width:Math.max(2,right-left),top,height:Math.max(18,bottom-top)}]
        }).slice(0,3)
        setPatternOverlays(nextPatterns)
      })
    }
    const receiveSync=(event:Event)=>{
      const detail=(event as CustomEvent<ChartSyncDetail>).detail
      if(!detail||detail.group!==syncGroup||detail.source===paneId)return
      const coordinate=chart.timeScale().timeToCoordinate(detail.trading_date as any)
      setCrosshairX(coordinate==null?null:coordinate)
    }
    const publishSync=(event:any)=>{
      const time=event.time
      if(!time)return
      const tradingDate=typeof time==='string'?time:`${time.year}-${String(time.month).padStart(2,'0')}-${String(time.day).padStart(2,'0')}`
      const coordinate=chart.timeScale().timeToCoordinate(time)
      setCrosshairX(coordinate==null?null:coordinate)
      window.dispatchEvent(new CustomEvent<ChartSyncDetail>('protstock:chart-sync',{detail:{group:syncGroup,source:paneId,trading_date:tradingDate}}))
    }
    const observer=new ResizeObserver(entries=>{
      const width=Math.floor(entries[0]?.contentRect.width??0)
      if(width<2)return
      cancelAnimationFrame(resizeFrame)
      resizeFrame=requestAnimationFrame(()=>{
        const liveWidth=Math.floor(host.getBoundingClientRect().width)
        if(liveWidth>1){chart.applyOptions({width:liveWidth});syncPatterns()}
      })
    })
    observer.observe(host)
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncPatterns)
    chart.subscribeCrosshairMove(publishSync)
    window.addEventListener('protstock:chart-sync',receiveSync)
    syncPatterns()
    return()=>{
      window.removeEventListener('protstock:theme-change',recolor)
      window.removeEventListener('protstock:theme-change',recolorZones)
      cancelAnimationFrame(frame)
      cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncPatterns)
      chart.unsubscribeCrosshairMove(publishSync)
      window.removeEventListener('protstock:chart-sync',receiveSync)
      chart.remove()
    }
  },[bars,zones,patterns,indicators,syncGroup,paneId])
  return <div className="stock-chart" ref={ref} aria-label={`${paneLabel??'Biểu đồ'} nến, khối lượng và đường trung bình`}><div className="chart-overlay" aria-hidden="true">{crosshairX!=null&&<i className="synced-crosshair" style={{left:crosshairX}}/>}{patternOverlays.map(pattern=><span key={pattern.id} className="pattern-box" style={{left:pattern.left,width:pattern.width,top:pattern.top,height:pattern.height}}>{patternNames[pattern.pattern_type]??pattern.pattern_type} · {Math.round(pattern.quality_score)}</span>)}</div><div className={touchLocked?'chart-touch-lock locked':'chart-touch-lock'}><button type="button" onClick={()=>setTouchLocked(value=>!value)}>{touchLocked?'🔒 Khóa vuốt chart':'🔓 Mở chart'}</button><small>{touchLocked?'Cuộn trang an toàn':'Chạm/zoom biểu đồ đang bật'}</small></div></div>
}
