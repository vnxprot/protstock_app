import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { unsettledLotStates } from '../lib/signalTriage'
import './DualEngineComparePanel.css'

export type ChampionSignal = { symbol_id: number; symbol: string; sector: string | null; action: string; as_of_date: string }
type ShadowRow = { symbol_id: number; trading_date: string; action: string; reasons: string[];
  distance_to_base_pct: number | null; evidence: { market_regime?: string; risk_tier?: string; shadow_only?: boolean } }
type Outcome = { engine: 'CHAMPION' | 'CHALLENGER'; action: string; net_return_pct: number; locked_drawdown_pct: number }

function score(rows: Outcome[], engine: Outcome['engine']) {
  const samples = rows.filter(row => row.engine === engine)
  if (!samples.length) return null
  const gains = samples.reduce((sum, row) => sum + Math.max(0, Number(row.net_return_pct)), 0)
  const losses = samples.reduce((sum, row) => sum + Math.max(0, -Number(row.net_return_pct)), 0)
  return { count: samples.length,
    win: samples.filter(row => Number(row.net_return_pct) > 0).length / samples.length * 100,
    drawdown: samples.reduce((sum, row) => sum + Number(row.locked_drawdown_pct), 0) / samples.length,
    cumulative: (samples.reduce((value, row) => value * (1 + Number(row.net_return_pct) * (row.action === 'EARLY_PROBE' ? .30 : 1) / 100), 1) - 1) * 100,
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
  date: string; champion: ChampionSignal[]; mode: 'challenger' | 'compare'
}) {
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
  const championById = new Map(champion.filter(row => row.as_of_date === date).map(row => [row.symbol_id, row]))
  const rows = (shadow.data ?? []).filter(row => mode === 'compare' || ['PROBE_BUY', 'ADD', 'EARLY_PROBE'].includes(row.action))
  const championScore = score(outcomes.data ?? [], 'CHAMPION')
  const challengerScore = score(outcomes.data ?? [], 'CHALLENGER')
  return <article className="panel dual-engine-panel">
    <div className="panel-title"><div><h3>{mode === 'compare' ? 'Đối chiếu Champion – Challenger' : 'Challenger v2 · nghiên cứu song song'}</h3>
      <small>Chỉ dữ liệu EOD · Challenger không ghi lệnh vào danh mục</small></div><small>{date}</small></div>
    {shadow.isLoading && <p role="status">Đang tải đánh giá Challenger…</p>}
    {shadow.isError && <p className="form-error" role="alert">Chưa đọc được dữ liệu Challenger. Kiểm tra migration và lượt EOD gần nhất.</p>}
    {!shadow.isLoading && !shadow.isError && <>
      <div className="dual-scorecard" aria-label="Bảng điểm Champion Challenger">
        <div><span>Win rate lúc T+2</span><strong>Champion {championScore ? `${championScore.win.toFixed(1)}% · n=${championScore.count}` : '—'}</strong><strong>Challenger {challengerScore ? `${challengerScore.win.toFixed(1)}% · n=${challengerScore.count}` : '—'}</strong></div>
        <div><span>Sụt giảm bình quân khi khóa</span><strong>Champion {championScore ? `${championScore.drawdown.toFixed(1)}%` : '—'}</strong><strong>Challenger {challengerScore ? `${challengerScore.drawdown.toFixed(1)}%` : '—'}</strong></div>
        <div><span>Chỉ số ghép lượt tín hiệu</span><strong>Champion {championScore ? `${championScore.cumulative.toFixed(1)}%` : '—'}</strong><strong>Challenger {challengerScore ? `${challengerScore.cumulative.toFixed(1)}%` : '—'}</strong></div>
        <div><span>Profit factor T+2</span><strong>Champion {championScore?.profitFactor == null ? '—' : championScore.profitFactor.toFixed(2)}</strong><strong>Challenger {challengerScore?.profitFactor == null ? '—' : challengerScore.profitFactor.toFixed(2)}</strong></div>
      </div>
      <p className="muted">Chỉ tính lượt đã đủ T+2. Chỉ số ghép lượt tín hiệu áp dụng 30% quy mô cho EARLY_PROBE, không phải NAV danh mục; số lượt mỗi bên có thể khác nhau. Đáy ngày T+2 là proxy bảo thủ cho buổi sáng. Số phiên dẫn trước cần quan sát tiếp.</p>
      {outcomes.isError && <p className="muted">Chưa tải được kết quả T+2 của hai bộ máy.</p>}
      <div className="dual-engine-table-wrap"><table className="dual-engine-table"><thead><tr>
        <th>Mã</th>{mode === 'compare' && <th>Champion</th>}<th>Challenger</th><th>Delta Insight</th>
        <th>Khoảng cách nền</th><th>Ngành</th><th>Trạng thái T+</th>
      </tr></thead><tbody>{rows.map(row => { const primary = championById.get(row.symbol_id); return <tr key={row.symbol_id}>
        <th scope="row">{primary?.symbol ?? `#${row.symbol_id}`}</th>
        {mode === 'compare' && <td>{primary?.action ?? '—'}</td>}
        <td>{row.action}{row.evidence?.risk_tier === 'SPECULATIVE' ? ' · thăm dò 30%' : ''}</td>
        <td><span className="dual-insight">{insight(primary, row)}</span></td>
        <td>{row.distance_to_base_pct == null ? '—' : `${Number(row.distance_to_base_pct).toFixed(1)}%`}</td>
        <td>{primary?.sector ?? '—'}</td><td>{lots.data?.get(row.symbol_id)?.join(' · ') || '—'}</td>
      </tr> })}</tbody></table></div>
      {!rows.length && <p className="muted">Chưa có đánh giá Challenger cho phiên này.</p>}
    </>}
  </article>
}
