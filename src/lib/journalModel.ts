import { engineOrder } from './engineCatalog.ts'
import { tradeCosts, type CostRate } from './portfolioCosts.ts'
import type { LedgerTransaction } from './portfolioLedger.ts'
import type { JournalEvidenceSnapshot } from './journalEvidence.ts'
import { todayInVietnam } from './date.ts'

export const journalActions = { BUY: 'Mua', SELL: 'Bán', HOLD: 'Giữ', WAIT: 'Chờ', SKIP: 'Bỏ qua', STOP: 'Cắt lỗ' } as const
export const journalSources = { MANUAL: 'Tự tìm', ANALYSIS: 'Phân tích mã', SIGNALS: 'Signals', RADAR: 'Radar', FUNNEL: 'Phễu', MACD: 'MACD', PORTFOLIO: 'Danh mục', UNKNOWN: 'Chưa xác định' } as const
export const journalStrategies = [...engineOrder, 'Phễu MTF gốc', 'Phễu MTF thích ứng', 'Phân kỳ Dương · đường MACD', 'MACD đáy 2 · vào sớm', 'Spring · nhịp hồi phòng thủ', 'Cá nhân']
export const journalRoles = { CHAMPION: 'Champion', CHALLENGER: 'Challenger', PERSONAL: 'Cá nhân', UNKNOWN: 'Chưa xác định' } as const
export const journalStatuses = { PLANNED: 'Dự kiến', EXECUTED: 'Đã thực hiện', CANCELLED: 'Hủy' } as const
export const adherenceLabels = { FOLLOWED: 'Đúng quy tắc', BROKEN: 'Khác quy tắc', UNKNOWN: 'Chưa đánh giá' } as const
export type JournalAction = keyof typeof journalActions
export type JournalPlan = { entry?: number | null; stop?: number | null; target?: number | null; expires?: string; trigger?: string }
export type JournalEvaluationRule = { horizon: 5 | 10 | 20; direction: 'UP' | 'DOWN'; threshold: number }
export type JournalWorkflow = {
  schema: 1; source: keyof typeof journalSources; strategy: string; version: string; role: keyof typeof journalRoles
  status: keyof typeof journalStatuses; subtype: string; adherence: keyof typeof adherenceLabels
  support: string[]; checks: { label: string; passed: boolean }[]; plan: JournalPlan
  evaluation?: JournalEvaluationRule | null; emotion: string
  classified_at?: string; classification_timing?: 'AT_DECISION' | 'RETROSPECTIVE'
  evaluation_base?: {date:string;close:number;revision:string;basis:string}|null; evaluation_after?:string
}
export type JournalEntry = {
  id: string; user_id?: string; symbol_id: number; decision_date: string; created_at?: string; decision: JournalAction
  rationale: string; setup_type: string | null; market_state: string | null; outcome: string; result_pct: number | null
  lesson: string | null; review_status: string | null; thesis_version_id: string | null; evidence_snapshot: JournalEvidenceSnapshot | null
  transaction_id?: string | null; linked_transaction_id?: string | null; linked_cycle_id?: string | null; workflow: JournalWorkflow | null
  symbols?: { symbol: string; sector?: string | null } | null
}
export type JournalCycle = {
  id: string; portfolioId: string; symbolId: number; symbol: string; openedAt: string; closedAt: string | null
  quantity: number; invested: number; cost: number; pnl: number; transactions: JournalTransaction[]; entries: JournalEntry[]
  entry: JournalEntry | undefined; exit: JournalEntry | undefined; risk: number | null; r: number | null; invalid: boolean
}
export type JournalTransaction = LedgerTransaction & { portfolio_id?: string; stop_price?: number | null }
export const linkedTransaction = (entry: JournalEntry) => entry.linked_transaction_id ?? entry.transaction_id ?? null
export const entryStatus = (entry: JournalEntry): keyof typeof journalStatuses => linkedTransaction(entry) ? 'EXECUTED' : entry.workflow?.status ?? 'PLANNED'
export const strategyName = (entry?: JournalEntry) => entry?.workflow?.strategy || 'Chưa xác định'
export const strategyKey = (entry?: JournalEntry) => `${strategyName(entry)} · ${entry?.workflow?.version || 'Chưa rõ phiên bản'}`
export function journalConflict(evidence: JournalEvidenceSnapshot | null | undefined) {
  const reduce = evidence?.signals.some(signal => ['EXIT','REDUCE','SELL','STOP'].includes(signal.action))
  const buy = evidence?.challenger?.some(signal => ['BUY','PROBE_BUY','ADD'].includes(signal.action))
  return reduce && buy ? 'Champion đang yêu cầu giảm/thoát, Challenger có đề xuất mua. Ghi rõ lý do chọn theo bên nào.' : null
}
export function newWorkflow(): JournalWorkflow {
  return { schema: 1, source: 'MANUAL', strategy: '', version: '', role: 'PERSONAL', status: 'PLANNED', subtype: '', adherence: 'UNKNOWN', support: [], checks: [], plan: {}, emotion: 'DISCIPLINED' }
}

// A cycle is flat-to-flat within one portfolio. Partial exits never add samples.
export function buildJournalCycles(transactions: JournalTransaction[], entries: JournalEntry[], rates: Record<string, CostRate[]> = {}): JournalCycle[] {
  const cycles: JournalCycle[] = [], active = new Map<string, JournalCycle>()
  const sorted = [...transactions].sort((a, b) => a.trading_date.localeCompare(b.trading_date) || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))
  for (const tx of sorted) {
    const buy = ['BUY_NEW', 'BUY_ADD'].includes(tx.action), sell = ['SELL_REDUCE', 'SELL_CLOSE'].includes(tx.action)
    if (!buy && !sell) continue
    const key = `${tx.portfolio_id ?? ''}:${tx.symbol_id}`, qty = Number(tx.quantity), price = Number(tx.price)
    if (!(qty > 0 && price > 0)) continue
    let cycle = active.get(key)
    if (!cycle && buy) {
      cycle = { id: tx.id, portfolioId: tx.portfolio_id ?? '', symbolId: Number(tx.symbol_id), symbol: tx.symbols?.symbol ?? String(tx.symbol_id), openedAt: tx.trading_date, closedAt: null, quantity: 0, invested: 0, cost: 0, pnl: 0, transactions: [], entries: [], entry: undefined, exit: undefined, risk: null, r: null, invalid: false }
      cycles.push(cycle); active.set(key, cycle)
    }
    if (!cycle) continue
    const cost = tradeCosts(tx, rates[cycle.portfolioId] ?? [])
    cycle.transactions.push(tx)
    if (buy) { cycle.quantity += qty; cycle.invested += qty * price + cost.brokerFee; cycle.cost += qty * price + cost.brokerFee }
    else if (qty > cycle.quantity) { cycle.invalid = true }
    else {
      const basis = cycle.cost / cycle.quantity * qty
      cycle.pnl += qty * price - cost.total - basis; cycle.cost -= basis; cycle.quantity -= qty
      if (cycle.quantity === 0) { cycle.closedAt = tx.trading_date; active.delete(key) }
    }
  }
  for (const cycle of cycles) {
    const ids = new Set(cycle.transactions.map(tx => tx.id))
    cycle.entries = entries.filter(entry => ids.has(linkedTransaction(entry) ?? '') || entry.linked_cycle_id === cycle.id).sort((a, b) => a.decision_date.localeCompare(b.decision_date) || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    const forTx = (id: string) => cycle.entries.find(entry => linkedTransaction(entry) === id && entry.workflow) ?? cycle.entries.find(entry => linkedTransaction(entry) === id)
    cycle.entry = forTx(cycle.transactions[0].id)
    cycle.exit = cycle.closedAt ? forTx(cycle.transactions.at(-1)!.id) : undefined
    // R needs pre-recorded risk on every buy, including additions; never infer it from an exit.
    let risk = 0, complete = true
    for (const tx of cycle.transactions.filter(tx => ['BUY_NEW', 'BUY_ADD'].includes(tx.action))) {
      const note = forTx(tx.id), stop = note?.workflow?.plan.stop
      const captured = note?.workflow?.classified_at ?? note?.created_at
      const beforeTrade = captured && tx.created_at && Date.parse(captured) <= Date.parse(tx.created_at) && todayInVietnam(new Date(captured)) <= tx.trading_date
      if (!beforeTrade || !stop || stop >= Number(tx.price)) complete = false
      else risk += (Number(tx.price) - stop) * Number(tx.quantity)
    }
    cycle.risk = complete && risk > 0 ? risk : null
    cycle.r = cycle.closedAt && !cycle.invalid && cycle.risk ? cycle.pnl / cycle.risk : null
  }
  return cycles
}
export function wilsonInterval(wins: number, n: number): [number, number] | null {
  if (!n) return null
  const z2 = 1.96 ** 2, p = wins / n, denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator, delta = 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator
  return [Math.max(0, center - delta) * 100, Math.min(1, center + delta) * 100]
}
export function cycleStatistics(cycles: JournalCycle[]) {
  const closed = cycles.filter(cycle => cycle.closedAt && !cycle.invalid), wins = closed.filter(cycle => cycle.pnl > 0).length
  const gains = closed.reduce((sum, cycle) => sum + Math.max(0, cycle.pnl), 0), losses = closed.reduce((sum, cycle) => sum + Math.max(0, -cycle.pnl), 0)
  const rs = closed.flatMap(cycle => cycle.r == null ? [] : [cycle.r])
  return { n: closed.length, wins, pnl: gains - losses, winRate: closed.length ? wins / closed.length * 100 : null, interval: wilsonInterval(wins, closed.length), expectancy: closed.length ? (gains - losses) / closed.length : null, profitFactor: losses ? gains / losses : null, avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, rSamples: rs.length }
}

export type JournalLaunch = { symbol: string; source?: string; strategy?: string; role?: string; date?: string; version?: string }
export function journalHref(context: JournalLaunch) {
  return '#journal?' + new URLSearchParams(Object.entries(context).filter(([, value]) => Boolean(value)) as [string, string][]).toString()
}
