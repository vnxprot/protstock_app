import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { unsettledLotStates } from '../lib/signalTriage'
import type { SectorStrength } from '../lib/signalTriage'
import './DualEngineComparePanel.css'

export type ChampionSignal = { symbol_id: number; symbol: string; sector: string | null; action: string; as_of_date: string }
type ShadowRow = { symbol_id: number; trading_date: string; action: string; reasons: string[];
  distance_to_base_pct: number | null; evidence: { market_regime?: string; risk_tier?: string; shadow_only?: boolean } }
type StrategyCode = 'UPTREND_CORE' | 'SIDEWAY_RANGE' | 'ADAPTIVE_FUNNEL' | 'MACD_EARLY_ZONE' | 'DOWNTREND_SPRING'
type StrategyRow = { symbol_id: number; strategy_code: StrategyCode; action: string; reasons: string[];
  distance_to_base_pct: number | null; evidence: { size_multiplier?: number } }
type StrategyOutcome = { strategy_code: StrategyCode; net_return_pct: number; locked_drawdown_pct: number; size_multiplier: number }
type Outcome = { engine: 'CHAMPION' | 'CHALLENGER'; action: string; net_return_pct: number; locked_drawdown_pct: number }
const strategyNames: Record<StrategyCode, string> = { UPTREND_CORE: 'Uptrend · Breakout/VCP/Pullback', SIDEWAY_RANGE: 'Sideway · hồi về nền/Pocket Pivot', ADAPTIVE_FUNNEL: 'Phễu MTF thích ứng', MACD_EARLY_ZONE: 'MACD đáy 2 · vào sớm', DOWNTREND_SPRING: 'Downtrend · Spring thăm dò' }

function score(rows: Outcome[], engine: Outcome['engine']) {
  const samples = rows.filter(row => row.engine === engine)
  if (!samples.length) return null
  const gains = samples.reduce((sum, row) => sum + Math.max(0, Number(row.net_return_pct)), 0)
  const losses = samples.reduce((sum, row) => sum + Math.max(0, -Number(row.net_return_pct)), 0)
  return { count: samples.length,
    win: samples.filter(row => Number(row.net_return_pct) > 0).length / samples.length * 100,
    drawdown: samples.reduce((sum, row) => sum + Number(row.locked_drawdown_pct), 0) / samples.length,
    cumulative: (samples.reduce((value, row) => value * (1 + Number(row.net_return_pct) / 100), 1) - 1) * 100,
    profitFactor: losses ? gains / losses : null }
}

function insight(champion: ChampionSignal | undefined, shadow: ShadowRow): string {
  if (shadow.reasons.includes('CHASE_BLOCKED')) return 'CHASE_BLOCKED'
  if (shadow.reasons.includes('SIDEWAY_BREAKOUT_REJECTED')) return 'SIDEWAY_REJECTED'
  if (shadow.action === 'EARLY_PROBE' && !['PROBE_BUY', 'ADD'].includes(champion?.action ?? '')) return 'EARLY_LEAD'
  if (shadow.action === champion?.action || shadow.action === 'EARLY_PROBE' && ['PROBE_BUY', 'ADD'].includes(champion?.action ?? '')) return 'ALIGNED'
  return 'DIFFERENT'
}

export function DualEngineComparePanel({ date, champion, mode }: {
  date: string; champion: ChampionSignal[]; mode: 'challenger' | 'compare' | 'watch' | 'summary'
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const shadow = useQuery({ queryKey: ['challenger-shadow', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async () => {
    const rows: ShadowRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('challenger_signal_assessments')
        .select('symbol_id,trading_date,action,reasons,distance_to_base_pct,evidence')
        .eq('trading_date', date).eq('engine_version', 'v2.0-challenger').order('symbol_id').range(from, from + 999)
      if (error) throw error
      rows.push(...((data ?? []) as ShadowRow[]))
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })
  const outcomes = useQuery({ queryKey: ['dual-engine-tplus-score', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async () => {
    const rows: Outcome[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('dual_engine_tplus_outcomes')
        .select('engine,action,net_return_pct,locked_drawdown_pct').lte('matured_date', date)
        .order('matured_date').range(from, from + 999)
      if (error) throw error
      rows.push(...((data ?? []) as Outcome[]))
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })
  const strategies = useQuery({ queryKey: ['challenger-strategies', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async () => {
    const rows: StrategyRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('challenger_strategy_assessments')
        .select('symbol_id,strategy_code,action,reasons,distance_to_base_pct,evidence')
        .eq('trading_date', date).eq('engine_version', 'v2.0-challenger').order('symbol_id').range(from, from + 999)
      if (error) throw error
      rows.push(...((data ?? []) as StrategyRow[]))
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })
  const strategyOutcomes = useQuery({ queryKey: ['challenger-strategy-outcomes', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async () => {
    const rows: StrategyOutcome[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('challenger_strategy_tplus_outcomes')
        .select('strategy_code,net_return_pct,locked_drawdown_pct,size_multiplier').lte('matured_date', date)
        .order('matured_date').range(from, from + 999)
      if (error) throw error
      rows.push(...((data ?? []) as StrategyOutcome[]))
      if ((data ?? []).length < 1000) break
    }
    return rows
  } })
  const lots = useQuery({ queryKey: ['dual-engine-lots', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async () => {
    const transactions: { symbol_id: number; trading_date: string; action: string; quantity: number; created_at?: string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('portfolio_transactions')
        .select('symbol_id,trading_date,action,quantity,created_at').lte('trading_date', date)
        .order('trading_date').order('created_at').range(from, from + 999)
      if (error) throw error
      transactions.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
    const sessions = await supabase!.from('market_breadth_snapshots').select('trading_date').lte('trading_date', date).order('trading_date', { ascending: false }).limit(20)
    if (sessions.error) throw sessions.error
    return unsettledLotStates(transactions, date, (sessions.data ?? []).map(row => row.trading_date))
  } })
  const symbols = useQuery({ queryKey: ['dual-engine-symbols'], enabled: Boolean(supabase), queryFn: async () => {
    const { data, error } = await supabase!.from('symbols').select('id,symbol,sector').eq('active', true)
    if (error) throw error
    return new Map((data ?? []).map(row => [Number(row.id), { symbol: row.symbol as string, sector: row.sector as string | null }]))
  } })
  const sectors = useQuery({ queryKey: ['dual-engine-sectors', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async () => {
    const { data, error } = await supabase!.from('market_breadth_snapshots').select('sector_breadth').eq('trading_date', date).maybeSingle()
    if (error) throw error
    return new Map(((data?.sector_breadth ?? []) as (SectorStrength & { sector: string })[]).map(row => [row.sector, row]))
  } })
  const championById = new Map(champion.filter(row => row.as_of_date === date).map(row => [row.symbol_id, row]))
  const strategyById = new Map<number, StrategyRow[]>()
  for (const row of strategies.data ?? []) strategyById.set(row.symbol_id, [...(strategyById.get(row.symbol_id) ?? []), row])
  const rows = (shadow.data ?? []).filter(row => (mode === 'watch' ? row.action === 'WATCH' : true)
    && (symbols.data?.get(row.symbol_id)?.symbol ?? championById.get(row.symbol_id)?.symbol ?? '').toLowerCase().includes(search.toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(rows.length / 25))
  const visibleRows = rows.slice((Math.min(page, pageCount) - 1) * 25, Math.min(page, pageCount) * 25)
  const championScore = score(outcomes.data ?? [], 'CHAMPION')
  const challengerScore = score(outcomes.data ?? [], 'CHALLENGER')
  return <article className="panel dual-engine-panel">
    <div className="panel-title"><div><h3>{mode === 'compare' ? 'Đối chiếu Champion – Challenger' : 'Challenger v2 · nghiên cứu song song'}</h3>
      <small>Chỉ dữ liệu EOD · Challenger không ghi lệnh vào danh mục</small></div><small>{date}</small></div>
    {shadow.isLoading && <p role="status">Đang tải đánh giá Challenger…</p>}
    {shadow.isError && <p className="form-error" role="alert">Chưa đọc được dữ liệu Challenger. Kiểm tra migration và lượt EOD gần nhất.</p>}
    {!shadow.isLoading && !shadow.isError && shadow.data?.length === 0 &&
      <p className="form-error" role="alert">Phiên {date} chưa có bản đánh giá Challenger trong database. Champion vẫn có {championById.size} mã để đối chiếu; cần chạy bù phiên shadow này.</p>}
    {!shadow.isLoading && !shadow.isError && <>
      <div className="dual-scorecard" aria-label="Bảng điểm Champion Challenger">
        <div><span>Win rate lúc T+2</span><strong>Champion {championScore ? `${championScore.win.toFixed(1)}% · n=${championScore.count}` : '—'}</strong><strong>Challenger {challengerScore ? `${challengerScore.win.toFixed(1)}% · n=${challengerScore.count}` : '—'}</strong></div>
        <div><span>Sụt giảm bình quân khi khóa</span><strong>Champion {championScore ? `${championScore.drawdown.toFixed(1)}%` : '—'}</strong><strong>Challenger {challengerScore ? `${challengerScore.drawdown.toFixed(1)}%` : '—'}</strong></div>
        <div><span>Chỉ số ghép lượt tín hiệu</span><strong>Champion {championScore ? `${championScore.cumulative.toFixed(1)}%` : '—'}</strong><strong>Challenger {challengerScore ? `${challengerScore.cumulative.toFixed(1)}%` : '—'}</strong></div>
        <div><span>Profit factor T+2</span><strong>Champion {championScore?.profitFactor == null ? '—' : championScore.profitFactor.toFixed(2)}</strong><strong>Challenger {challengerScore?.profitFactor == null ? '—' : challengerScore.profitFactor.toFixed(2)}</strong></div>
      </div>
      <p className="muted">Chỉ tính lượt đã đủ T+2. Chỉ số ghép lượt tín hiệu dùng quy mô đơn vị, không phải NAV danh mục; số lượt mỗi bên có thể khác nhau. Đáy ngày T+2 là proxy bảo thủ cho buổi sáng. Số phiên dẫn trước cần quan sát tiếp.</p>
      {outcomes.isError && <p className="muted">Chưa tải được kết quả T+2 của hai bộ máy.</p>}
      <div className="dual-strategy-scorecard" aria-label="Kết quả riêng từng chiến lược Challenger">{(['UPTREND_CORE', 'SIDEWAY_RANGE', 'ADAPTIVE_FUNNEL', 'MACD_EARLY_ZONE', 'DOWNTREND_SPRING'] as const).map(code => {
        const samples = (strategyOutcomes.data ?? []).filter(row => row.strategy_code === code)
        const wins = samples.filter(row => Number(row.net_return_pct) > 0).length
        const drawdown = samples.reduce((sum, row) => sum + Number(row.locked_drawdown_pct), 0) / (samples.length || 1)
        const weightedReturn = samples.reduce((sum, row) => sum + Number(row.net_return_pct) * Number(row.size_multiplier), 0) / (samples.length || 1)
        const buys = (strategies.data ?? []).filter(row => row.strategy_code === code && ['PROBE_BUY', 'EARLY_PROBE'].includes(row.action)).length
        return <div key={code}><strong>{strategyNames[code]}</strong><span>{buys} tín hiệu mua phiên này · T+2 {samples.length ? `${(wins / samples.length * 100).toFixed(1)}% thắng · lợi suất theo quy mô ${weightedReturn.toFixed(1)}% · sụt giảm ${drawdown.toFixed(1)}% · n=${samples.length}` : 'chưa có mẫu đủ tuổi'}</span></div>
      })}</div>
      {strategies.isError && <p className="form-error" role="alert">Chưa đọc được các nhánh chiến lược Challenger.</p>}
      {strategyOutcomes.isError && <p className="muted">Chưa đọc được outcome T+2 theo từng chiến lược.</p>}
      {mode !== 'summary' && <>
      <div className="dual-engine-controls"><label>Tìm mã <input value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Ví dụ: FPT" /></label><span>{rows.length} mã · trang {Math.min(page, pageCount)}/{pageCount}</span></div>
      <div className="dual-engine-table-wrap"><table className="dual-engine-table"><thead><tr>
        <th>Mã</th>{mode === 'compare' && <th>Champion</th>}<th>Challenger</th><th>Delta Insight</th>
        <th>Chiến lược riêng</th><th>Khoảng cách nền</th><th>Sức mạnh ngành</th><th>Trạng thái T+</th>
      </tr></thead><tbody>{visibleRows.map(row => { const primary = championById.get(row.symbol_id); const stock = symbols.data?.get(row.symbol_id); const sector = primary?.sector ?? stock?.sector; const strength = sector ? sectors.data?.get(sector) : undefined; return <tr key={row.symbol_id}>
        <th scope="row">{primary?.symbol ?? stock?.symbol ?? `#${row.symbol_id}`}</th>
        {mode === 'compare' && <td>{primary?.action ?? '—'}</td>}
        <td>{row.action}{row.evidence?.risk_tier === 'SPECULATIVE' ? ' · thăm dò 30%' : ''}<small className="dual-reasons">{row.reasons.join(' · ')}</small></td>
        <td><span className="dual-insight">{insight(primary, row)}</span></td>
        <td>{(strategyById.get(row.symbol_id) ?? []).map(item => <span className="dual-strategy-label" key={item.strategy_code} title={item.reasons.join(' · ')}>{strategyNames[item.strategy_code]}: {item.action}</span>)}</td>
        <td>{row.distance_to_base_pct == null ? '—' : `${Number(row.distance_to_base_pct).toFixed(1)}%`}</td>
        <td>{sector ?? '—'}{strength && <small> · {Number(strength.market_health_score ?? 0).toFixed(0)} điểm · GTGD {Number(strength.turnover_share_pct ?? 0).toFixed(1)}%</small>}</td><td>{lots.data?.get(row.symbol_id)?.join(' · ') || '—'}</td>
      </tr> })}</tbody></table></div>
      {pageCount > 1 && <nav className="dual-engine-pages"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>‹ Trước</button><button type="button" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>Sau ›</button></nav>}
      {!rows.length && Boolean(shadow.data?.length) && <p className="muted">Không có đánh giá Challenger khớp bộ lọc hiện tại.</p>}
      </>}
    </>}
  </article>
}
