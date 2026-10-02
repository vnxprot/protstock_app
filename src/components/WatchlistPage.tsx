import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Plus, RotateCcw, Search, Sparkles, Star, X } from 'lucide-react'
import { useSymbols } from '../hooks/useStockAnalysis'
import { formatDate } from '../lib/date'
import { latestSignalPublication } from '../lib/signalPublication'
import { supabase } from '../lib/supabase'
import { isWatchActive, randomWatchlistIndex, retryWatchlistSync, setWatchlistTier, toggleWatchlistSymbol, useWatchlistPendingCount, useWatchlist, type WatchItem, type WatchTier } from '../lib/watchlist'
import { useAccountId } from '../hooks/useAccountId'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { StockThesisPanel } from './StockThesisPanel'
import '../watchlist-page.css'
import '../personal-workspace.css'

const tiers: { tier: WatchTier; name: string; description: string; light: string }[] = [
  { tier: 'B', name: 'Quan sát', description: 'Giữ trong tầm mắt, chờ thêm dữ liệu.', light: 'Ánh sáng đầu tiên' },
  { tier: 'A', name: 'Theo dõi sát', description: 'Ưu tiên kiểm tra khi bối cảnh thay đổi.', light: 'Niềm tin đang lớn' },
  { tier: 'S', name: 'Ưu tiên cao nhất', description: 'Xem xét đầu tiên; vẫn cần đủ điều kiện mua.', light: 'Rực sáng hy vọng' },
]
type SymbolInfo = { id: number; symbol: string; company_name: string | null; sector: string | null; trading_status: string }
type SignalInfo = { symbol_id: number; timeframe: string; composite_action: string }
type MacdInfo = { symbol_id: number; macd: number | null; macd_signal: number | null; as_of_date: string }

function openAnalysis(symbol: string) {
  localStorage.setItem('protstock-symbol', symbol)
  dispatchEvent(new CustomEvent('protstock:symbol', { detail: symbol }))
  location.hash = 'analysis'
}

export function WatchlistPage({ authenticated, syncStatus, canJournal = true }: { authenticated: boolean; syncStatus: 'loading' | 'ready' | 'error'; canJournal?: boolean }) {
  const allItems = useWatchlist()
  const items = allItems.filter(isWatchActive)
  const userId = useAccountId(authenticated)
  const pending = useWatchlistPendingCount()
  const [focusedSymbol, setFocusedSymbol] = useState<string|null>(null)
  const [removed, setRemoved] = useState<WatchItem|null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const closeDetail = useCallback(() => setFocusedSymbol(null),[])
  useDialogFocus(Boolean(focusedSymbol),detailRef,closeDetail)
  useEffect(() => { if (!removed) return; const timer=setTimeout(()=>setRemoved(null),8000); return()=>clearTimeout(timer) },[removed])
  const removeStock = (item:WatchItem) => { toggleWatchlistSymbol(item.symbol); setRemoved(item) }
  const undoRemove = () => { if (!removed) return; setWatchlistTier(removed.symbol,removed.tier); setRemoved(null) }
  const symbols = useSymbols(authenticated)
  const symbolByCode = useMemo(() => new Map((symbols.data ?? []).map(item => [item.symbol, item as SymbolInfo])), [symbols.data])
  const [query, setQuery] = useState('')
  const [selectedTiers, setSelectedTiers] = useState<WatchTier[]>(['B', 'A', 'S'])
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [preview, setPreview] = useState('')
  const [winner, setWinner] = useState<WatchItem | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => { timers.current.forEach(timer => { clearInterval(timer); clearTimeout(timer) }) }, [])
  const publication = useQuery({ queryKey: ['watchlist-publication'], enabled: authenticated && Boolean(supabase), staleTime: 60_000, refetchInterval: 60_000, queryFn: latestSignalPublication })
  const date = publication.data?.date ?? ''
  const ids = useMemo(() => items.map(item => symbolByCode.get(item.symbol)?.id).filter((id): id is number => id != null), [items, symbolByCode])
  const theses = useQuery({queryKey:['watchlist-theses',userId,ids.join(',')],enabled:Boolean(userId&&supabase&&ids.length),staleTime:30_000,queryFn:async()=>{
    const {data:links,error:linkError}=await supabase!.from('investment_theses').select('symbol_id,current_version_id').eq('user_id',userId!).in('symbol_id',ids)
    if(linkError)throw linkError
    const versionIds=(links??[]).map(item=>item.current_version_id).filter(Boolean)
    if(!versionIds.length)return new Map<number,{thesis:string;review_status:string}>()
    const {data:versions,error}=await supabase!.from('investment_thesis_versions').select('id,thesis,review_status').in('id',versionIds)
    if(error)throw error
    const byVersion=new Map((versions??[]).map(item=>[item.id,item]))
    return new Map((links??[]).map(item=>[Number(item.symbol_id),byVersion.get(item.current_version_id)]))
  }})
  const eod = useQuery({
    queryKey: ['watchlist-eod', date, ids.join(',')], enabled: authenticated && Boolean(supabase) && Boolean(date) && ids.length > 0, staleTime: 60_000, refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('daily_prices').select('symbol_id,close,volume,quality_status').eq('trading_date', date).in('symbol_id', ids)
      if (error) throw error
      return new Set((data ?? []).filter(row => Number(row.close) > 0 && Number(row.volume) > 0 && row.quality_status === 'VALID').map(row => Number(row.symbol_id)))
    },
  })
  const signals = useQuery({
    queryKey: ['watchlist-signals', date, publication.data?.sourceRevision, ids.join(',')], enabled: authenticated && Boolean(supabase) && Boolean(date) && ids.length > 0, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('consolidated_signals').select('symbol_id,timeframe,composite_action')
        .eq('as_of_date', date).eq('source_revision', publication.data!.sourceRevision).in('symbol_id', ids)
      if (error) throw error
      return (data ?? []) as SignalInfo[]
    },
  })
  const macd = useQuery({
    queryKey: ['watchlist-macd', date, publication.data?.sourceRevision, ids.join(',')], enabled: authenticated && Boolean(supabase) && Boolean(date) && ids.length > 0, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('technical_snapshots').select('symbol_id,macd,macd_signal,as_of_date')
        .eq('timeframe', 'D').eq('as_of_date', date).eq('algorithm_version', publication.data!.sourceRevision).in('symbol_id', ids)
      if (error) throw error
      return new Map((data as MacdInfo[] ?? []).map(row => [row.symbol_id, row]))
    },
  })
  const signalsById = useMemo(() => {
    const map = new Map<number, SignalInfo[]>()
    ;(signals.data ?? []).forEach(signal => map.set(signal.symbol_id, [...(map.get(signal.symbol_id) ?? []), signal]))
    return map
  }, [signals.data])
  const eligible = useMemo(() => items.filter(item => {
    const symbol = symbolByCode.get(item.symbol)
    return selectedTiers.includes(item.tier) && symbol?.trading_status === 'NORMAL' && eod.data?.has(symbol.id)
  }), [items, symbolByCode, selectedTiers, eod.data])
  const candidates = (symbols.data ?? []).filter(item => !items.some(watch => watch.symbol === item.symbol)
    && `${item.symbol} ${item.company_name ?? ''} ${item.sector ?? ''}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi'))).slice(0, 8)
  const wheelColors: Record<WatchTier, string> = { B: '#7e9ba9', A: '#44cbb0', S: '#ffd76a' }
  const wheelGradient = eligible.length ? `conic-gradient(${eligible.map((item, index) => `${wheelColors[item.tier]} ${index / eligible.length * 100}% ${(index + 1) / eligible.length * 100}%`).join(',')})` : undefined
  const tierCounts = Object.fromEntries(tiers.map(item => [item.tier, items.filter(stock => stock.tier === item.tier).length])) as Record<WatchTier, number>
  const winnerInfo = winner ? symbolByCode.get(winner.symbol) : null
  const winnerSignals = winnerInfo ? signalsById.get(winnerInfo.id) ?? [] : []

  function toggleTier(tier: WatchTier) {
    if (spinning) return
    setWinner(null)
    setSelectedTiers(current => current.includes(tier) ? current.filter(value => value !== tier) : [...current, tier])
  }
  function spin() {
    if (spinning || !eligible.length || eod.isLoading) return
    const index = randomWatchlistIndex(eligible.length)
    const selected = eligible[index]
    const center = (index + 0.5) * 360 / eligible.length
    const step = (360 - center - rotation % 360 + 360) % 360
    setWinner(null)
    setSpinning(true)
    setPreview(eligible[0].symbol)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRotation(value => value + step)
      setPreview(selected.symbol)
      setWinner(selected)
      setSpinning(false)
      return
    }
    setRotation(value => value + 1440 + step)
    const cycle = window.setInterval(() => setPreview(eligible[Math.floor(Math.random() * eligible.length)].symbol), 95)
    const finish = window.setTimeout(() => {
      clearInterval(cycle)
      setPreview(selected.symbol)
      setWinner(selected)
      setSpinning(false)
      timers.current = timers.current.filter(timer => timer !== cycle && timer !== finish)
    }, 2900)
    timers.current.push(cycle, finish)
  }

  return <section className="workspace-page watchlist-page">
    {syncStatus === 'error' && <p className="watchlist-sync-warning" role="status">Chưa đồng bộ được. Thay đổi đang chờ vẫn lưu theo tài khoản trên thiết bị. <button type="button" onClick={retryWatchlistSync}>Thử lại</button></p>}
    {pending > 0 && <p role="status" className="watchlist-sync-warning">{pending} thay đổi đang chờ đồng bộ.</p>}
    {removed && <div className="watchlist-undo" role="status">Đã chuyển {removed.symbol} sang Off và giữ thông tin trong bảng. <button type="button" onClick={undoRemove}>Hoàn tác</button></div>}
    {symbols.isError && <p className="form-error" role="alert">Không đọc được danh sách mã. <button type="button" onClick={() => void symbols.refetch()}>Thử lại</button></p>}
    <header className="watchlist-hero"><div><span className="eyebrow">PROT WATCHLIST · B → A → S</span><h1>Những mã đáng để mắt tới</h1><p>Theo dõi mã, đọc lý do đầu tư của bạn và ghi lại điều cần xem lại. Tier chỉ thể hiện ưu tiên cá nhân.</p></div><div className="watchlist-hero-count"><Star size={22}/><strong>{items.length}</strong><span>mã đang theo dõi</span></div></header>
    <a href="#watchlist-board" className="secondary-button personal-desktop-action">Mở bảng Watchlist · Tier, lý do, vùng mua và On/Off</a>
    <section className="watchlist-add panel" aria-label="Thêm mã vào Watchlist"><div><h2>Thêm vào Watchlist</h2><p>Mã mới vào Tier B; sau đó bạn có thể nâng lên A hoặc S.</p></div><label><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm mã, công ty hoặc ngành…" aria-label="Tìm mã để thêm vào Watchlist"/></label>{query.trim() && <div className="watchlist-suggestions">{candidates.length ? candidates.map(item => <button key={item.symbol} type="button" onClick={() => { toggleWatchlistSymbol(item.symbol); setQuery(''); setFocusedSymbol(item.symbol) }}><strong>{item.symbol}</strong><span>{item.company_name ?? item.sector ?? 'Chưa có tên'}</span><Plus size={16}/></button>) : <span>Không còn mã phù hợp để thêm.</span>}</div>}</section>
    <div className="watchlist-tier-grid">{tiers.map(({ tier, name, description, light }) => <section key={tier} className={`watch-tier watch-tier-${tier.toLowerCase()}`} aria-label={`Tier ${tier}`}><div className="watch-tier-glow" aria-hidden="true"/><div className="watch-tier-head"><span className="watch-tier-orbit"><Sparkles size={tier === 'S' ? 24 : 19}/></span><div><span className="watch-tier-kicker">{light}</span><h2>Tier {tier} <small>{name}</small></h2></div><strong className="watch-tier-count">{tierCounts[tier]}</strong></div><p>{description}</p><div className="watch-tier-items">{items.filter(item => item.tier === tier).map(item => {
      const symbol = symbolByCode.get(item.symbol)
      const fresh = symbol && eod.data?.has(symbol.id)
      const status = symbol?.trading_status !== 'NORMAL' ? 'Không giao dịch bình thường' : fresh ? `EOD ${formatDate(date)}` : eod.isLoading ? 'Đang kiểm tra EOD' : eod.isError ? 'Không kiểm tra được EOD' : 'Thiếu EOD đúng phiên'
      const decisions = symbol ? signalsById.get(symbol.id) ?? [] : []
      const macdPoint = symbol ? macd.data?.get(symbol.id) : undefined
      const macdState = macdPoint?.macd == null || macdPoint.macd_signal == null ? macd.isError ? 'MACD: chưa tải được' : 'MACD: chờ dữ liệu' : macdPoint.macd > macdPoint.macd_signal ? 'MACD trên Signal' : 'MACD dưới Signal'
      return <article key={item.symbol} className="watch-stock"><div className="watch-stock-top"><button type="button" className="watch-stock-symbol" onClick={() => setFocusedSymbol(item.symbol)} aria-label={`Xem luận điểm mã ${item.symbol}`}>{item.symbol}<ArrowUpRight size={14}/></button><button type="button" className="watch-stock-remove" onClick={() => removeStock(item)} aria-label={`Chuyển ${item.symbol} sang Off, giữ lý do trong bảng`}><X size={15}/></button></div><span className="watch-stock-name">{symbol?.company_name ?? 'Mã ngoài universe hoạt động'}</span><small>{symbol?.sector ?? 'Chưa phân ngành'} · {status}</small><div className="watch-stock-signals"><span>{macdState}</span>{decisions.length ? decisions.sort((a, b) => 'DWM'.indexOf(a.timeframe) - 'DWM'.indexOf(b.timeframe)).map(signal => <span key={signal.timeframe}>{signal.timeframe} · {signal.composite_action}</span>) : <span>{signals.isError ? 'Chưa tải được tín hiệu' : signals.isLoading ? 'Đang tải tín hiệu…' : 'Không có tín hiệu mới'}</span>}</div><div className="watch-stock-why"><strong>Vì sao tôi theo dõi?</strong><p>{symbol && theses.data?.get(symbol.id)?.thesis || item.reason || (theses.isLoading ? 'Đang tải luận điểm…' : theses.isError ? 'Chưa tải được luận điểm' : 'Chưa ghi lý do. Bấm mã để viết luận điểm cá nhân.')}</p></div><div className="watch-stock-quick"><button type="button" onClick={() => setFocusedSymbol(item.symbol)}>Luận điểm</button>{canJournal && <a href={'#journal?symbol='+encodeURIComponent(item.symbol)}>Ghi nhanh</a>}<button type="button" className="personal-desktop-action" onClick={() => openAnalysis(item.symbol)}>Phân tích</button></div><div className="watch-stock-tiers" role="group" aria-label={`Chọn Tier cho ${item.symbol}`}>{tiers.map(option => <button key={option.tier} type="button" className={option.tier === tier ? 'active' : ''} aria-pressed={option.tier === tier} onClick={() => setWatchlistTier(item.symbol, option.tier)}>{option.tier}</button>)}</div></article>
    })}{!tierCounts[tier] && <p className="watch-tier-empty">Chưa có mã. Một lựa chọn mới có thể bắt đầu từ đây.</p>}</div></section>)}</div>
    <details className="watch-roulette-disclosure personal-desktop-panel"><summary>Khám phá ngẫu nhiên · tiện ích tùy chọn</summary><section className="watch-roulette panel" aria-label="Roulette chọn mã để nghiên cứu"><div className="watch-roulette-intro"><span className="eyebrow">RANDOM DISCOVERY</span><h2>Roulette · chọn mã để nghiên cứu</h2><p>Chọn Tier tham gia. Mỗi mã đủ điều kiện có xác suất bằng nhau; kết quả không phải khuyến nghị mua.</p></div><div className="watch-roulette-layout"><div className="watch-wheel-stage"><div className="watch-wheel-pointer" aria-hidden="true"/><div className="watch-wheel" style={{ background: wheelGradient, transform: `rotate(${rotation}deg)` }} aria-hidden="true"/><div className="watch-wheel-center" aria-live="polite"><span>{spinning ? 'ĐANG QUAY' : winner ? 'MÃ ĐƯỢC CHỌN' : 'SẴN SÀNG'}</span><strong>{preview || 'PROT'}</strong></div></div><div className="watch-roulette-controls"><div className="watch-roulette-tier-select" role="group" aria-label="Tier tham gia Roulette">{tiers.map(item => <button key={item.tier} type="button" disabled={spinning} aria-pressed={selectedTiers.includes(item.tier)} className={`roulette-tier roulette-tier-${item.tier.toLowerCase()}${selectedTiers.includes(item.tier) ? ' active' : ''}`} onClick={() => toggleTier(item.tier)}>Tier {item.tier}<small>{tierCounts[item.tier]} mã</small></button>)}</div><div className="watch-roulette-odds"><strong>{eligible.length ? `1/${eligible.length}` : '—'}</strong><span>xác suất mỗi mã đủ điều kiện · EOD {formatDate(date)}</span></div><p className="watch-roulette-note">{items.length - eligible.length} mã đang ngoài vòng quay do Tier chưa chọn, trạng thái giao dịch hoặc thiếu dữ liệu EOD hợp lệ.</p><button className="watch-spin-button" type="button" disabled={spinning || !eligible.length || eod.isLoading || eod.isError} onClick={spin}>{spinning ? 'Đang quay…' : winner ? <><RotateCcw size={18}/> Quay lại</> : <><Sparkles size={18}/> Bắt đầu quay</>}</button>{!eligible.length && <small className="watch-roulette-disabled">{publication.isLoading || eod.isLoading ? 'Đang kiểm tra danh sách và EOD…' : 'Chọn Tier có mã giao dịch bình thường và có giá đúng phiên để quay.'}</small>}</div></div>
      {winner && <div className={`watch-roulette-result watch-tier-${winner.tier.toLowerCase()}`} role="status"><div><span>Kết quả ngẫu nhiên · Tier {winner.tier}</span><strong>{winner.symbol}</strong><small>{winnerInfo?.company_name ?? winnerInfo?.sector ?? 'Xem phân tích mã'} · EOD {formatDate(date)}</small><div>{winnerSignals.length ? winnerSignals.map(signal => <span key={signal.timeframe}>{signal.timeframe} · {signal.composite_action}</span>) : <span>{signals.isError ? 'Chưa tải được tín hiệu' : signals.isLoading ? 'Đang tải tín hiệu…' : 'Không có tín hiệu mới'}</span>}</div></div><button type="button" onClick={() => openAnalysis(winner.symbol)}>Xem phân tích <ArrowUpRight size={16}/></button></div>}
      <p className="watch-roulette-disclaimer">Roulette chỉ quyết định mã nào được xem xét trước. Kiểm tra signal, Market Gate, giá và rủi ro danh mục trước mọi quyết định giải ngân. Watchlist được đồng bộ theo tài khoản; lượt quay không lưu lịch sử, không gửi Telegram hay tạo giao dịch.</p>
    </section></details>
    {focusedSymbol && <div className="sheet-backdrop" onMouseDown={closeDetail}><section ref={detailRef} role="dialog" aria-modal="true" aria-labelledby="watch-detail-title" tabIndex={-1} className="bottom-sheet watch-detail-sheet" onMouseDown={event=>event.stopPropagation()}><div className="sheet-title"><h2 id="watch-detail-title">{focusedSymbol} · Luận điểm của tôi</h2><button type="button" className="icon-button" aria-label="Đóng luận điểm" onClick={closeDetail}><X size={20}/></button></div>{allItems.find(item=>item.symbol===focusedSymbol)?.reason&&<details className="watch-legacy-reason"><summary>Lý do đã ghi trong bảng Watchlist</summary><p>{allItems.find(item=>item.symbol===focusedSymbol)?.reason}</p><a className="personal-desktop-action" href="#watchlist-board">Xem vùng mua, mục tiêu và cắt lỗ trong bảng</a></details>}<StockThesisPanel symbol={focusedSymbol} compact authenticated={authenticated} canJournal={canJournal}/><div className="watch-detail-actions">{canJournal&&<a className="primary-button" href={'#journal?symbol='+encodeURIComponent(focusedSymbol)}>Ghi nhật ký nhanh</a>}<button type="button" className="secondary-button personal-desktop-action" onClick={()=>openAnalysis(focusedSymbol)}>Phân tích đầy đủ</button></div><p className="muted">Luận điểm là ý kiến cá nhân. Tín hiệu hệ thống và độ phủ EOD được đọc riêng.</p></section></div>}
  </section>
}
