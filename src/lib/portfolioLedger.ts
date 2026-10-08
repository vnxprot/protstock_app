import { todayInVietnam } from './date.ts'
import { tradeCosts, type CostRate } from './portfolioCosts.ts'

export type LedgerTransaction = { id: string; symbol_id: string | number; trading_date: string; created_at?: string; action: string; quantity: number; price: number | null; broker_fee_override?: number | null; sell_tax_override?: number | null; symbols?: { symbol: string; sector?: string | null } | null }
export type CapitalMovement = { id: string; movement_type: string; amount: number; effective_date: string; created_at?: string; note?: string | null }
export type LedgerPrice = { symbol_id: string | number; trading_date: string; close: number }
export type LedgerReport = { portfolio: { capital: number; created_at?: string; initial_capital?: number }; initial_capital?: number; transactions: LedgerTransaction[]; capital_movements: CapitalMovement[]; prices: LedgerPrice[] }
export type RealizedSlice = { costBasis: number; pnl: number; returnPct: number; openedAt: string; quantity: number }

const chronological = (a: LedgerTransaction, b: LedgerTransaction) => a.trading_date.localeCompare(b.trading_date) || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id)
export function openCostBasis(rows: LedgerTransaction[], rates: CostRate[] = []) {
  const holdings: Record<string, { quantity: number; cost: number }> = {}
  for (const item of [...rows].sort(chronological)) {
    const key = String(item.symbol_id), quantity = Number(item.quantity), price = Number(item.price)
    if (['BUY_NEW', 'BUY_ADD'].includes(item.action) && quantity > 0 && price > 0) {
      const held = holdings[key] ?? { quantity: 0, cost: 0 }
      holdings[key] = { quantity: held.quantity + quantity, cost: held.cost + quantity * price + tradeCosts(item, rates).brokerFee }
    } else if (['SELL_REDUCE', 'SELL_CLOSE'].includes(item.action) && holdings[key] && quantity > 0) {
      const held = holdings[key]
      const used = Math.min(quantity, held.quantity)
      held.cost -= held.cost / held.quantity * used
      held.quantity -= used
      if (!held.quantity) delete holdings[key]
    }
  }
  return holdings
}
export function realizedSlices(rows: LedgerTransaction[], rates: CostRate[] = []): Record<string, RealizedSlice> {
  const holdings: Record<string, { quantity: number; cost: number; openedAt: string }> = {}
  const results: Record<string, RealizedSlice> = {}
  for (const item of [...rows].sort(chronological)) {
    const key = String(item.symbol_id), quantity = Number(item.quantity), price = Number(item.price)
    const costs = tradeCosts(item, rates)
    if (['BUY_NEW', 'BUY_ADD'].includes(item.action) && quantity > 0 && price > 0) {
      const held = holdings[key] ?? { quantity: 0, cost: 0, openedAt: item.trading_date }
      holdings[key] = { quantity: held.quantity + quantity, cost: held.cost + quantity * price + costs.brokerFee, openedAt: held.openedAt }
    } else if (['SELL_REDUCE', 'SELL_CLOSE'].includes(item.action) && quantity > 0 && price > 0) {
      const held = holdings[key]
      if (!held || held.quantity < quantity) continue
      const costBasis = held.cost / held.quantity * quantity, pnl = quantity * price - costs.total - costBasis
      results[item.id] = { costBasis, pnl, returnPct: costBasis ? pnl / costBasis * 100 : 0, openedAt: held.openedAt, quantity }
      held.quantity -= quantity; held.cost -= costBasis
      if (!held.quantity) delete holdings[key]
    }
  }
  return results
}

export function portfolioTimeline(report: LedgerReport, rates: CostRate[] = []) {
  const transactions = [...report.transactions].sort(chronological)
  const movements = [...report.capital_movements].sort((a, b) => a.effective_date.localeCompare(b.effective_date) || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))
  const signed = (item: CapitalMovement) => (item.movement_type === 'DEPOSIT' ? 1 : -1) * Number(item.amount)
  const initialCapital = Number(report.initial_capital ?? report.portfolio.initial_capital ?? (Number(report.portfolio.capital) - movements.reduce((sum, item) => sum + signed(item), 0)))
  const eventDates = [...transactions.map(item => item.trading_date), ...movements.map(item => item.effective_date)]
  const createdAt = report.portfolio.created_at ? new Date(report.portfolio.created_at) : null
  const createdDate = createdAt && !Number.isNaN(createdAt.getTime()) ? todayInVietnam(createdAt) : undefined
  const firstDate = [...eventDates, ...(createdDate ? [createdDate] : [])].sort()[0] ?? report.prices.map(item => item.trading_date).sort()[0]
  if (!firstDate) return []
  const dates = [...new Set([firstDate, ...eventDates, ...report.prices.map(item => item.trading_date)])].filter(date => date >= firstDate).sort()
  const pricesByDate: Record<string, LedgerPrice[]> = {}
  for (const row of report.prices) (pricesByDate[row.trading_date] ??= []).push(row)
  const holdings: Record<string, { quantity: number; cost: number }> = {}
  const marks: Record<string, { value: number; date: string }> = {}
  let cash = 0, capital = 0, txIndex = 0, movementIndex = 0, previousNav = 0, growth = 1
  return dates.map((date, index) => {
    let flow = index === 0 ? initialCapital : 0
    while (movementIndex < movements.length && movements[movementIndex].effective_date <= date) flow += signed(movements[movementIndex++])
    capital += flow; cash += flow
    while (txIndex < transactions.length && transactions[txIndex].trading_date <= date) {
      const item = transactions[txIndex++], key = String(item.symbol_id), quantity = Number(item.quantity), price = Number(item.price)
      const costs = tradeCosts(item, rates)
      if (['BUY_NEW', 'BUY_ADD'].includes(item.action) && quantity > 0 && price > 0) {
        const held = holdings[key] ?? { quantity: 0, cost: 0 }
        holdings[key] = { quantity: held.quantity + quantity, cost: held.cost + quantity * price + costs.brokerFee }
        cash -= quantity * price + costs.brokerFee
      } else if (['SELL_REDUCE', 'SELL_CLOSE'].includes(item.action) && quantity > 0 && price > 0 && holdings[key]) {
        const held = holdings[key], used = Math.min(quantity, held.quantity), average = held.cost / held.quantity
        cash += used * price - costs.total; held.quantity -= used; held.cost -= used * average
        if (!held.quantity) delete holdings[key]
      }
    }
    for (const row of pricesByDate[date] ?? []) marks[String(row.symbol_id)] = { value: Number(row.close) * 1000, date }
    let missingPrices = 0, stalePrices = 0
    const marketValue = Object.entries(holdings).reduce((sum, [key, held]) => {
      const mark = marks[key]
      if (!mark) missingPrices += 1
      else if (mark.date !== date) stalePrices += 1
      return sum + held.quantity * (mark?.value ?? held.cost / held.quantity)
    }, 0)
    const nav = cash + marketValue
    // Contributions/withdrawals are assumed at the beginning of their effective day.
    const denominator = previousNav + flow
    const dailyReturn = denominator > 0 ? nav / denominator - 1 : null
    if (dailyReturn != null) growth *= 1 + dailyReturn
    previousNav = nav
    return { date, nav, cash, capital, marketValue, netFlow: flow, value: (growth - 1) * 100, dailyReturn, missingPrices, stalePrices }
  })
}
