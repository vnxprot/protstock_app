import { todayInVietnam } from './date.ts'
import { tradeCosts, type CostRate } from './portfolioCosts.ts'

export type LedgerTransaction = { id: string; symbol_id: string | number; trading_date: string; created_at?: string; action: string; quantity: number; price: number | null; broker_fee_override?: number | null; sell_tax_override?: number | null; symbols?: { symbol: string; sector?: string | null } | null }
export type CapitalMovement = { id: string; movement_type: string; amount: number; effective_date: string; created_at?: string; note?: string | null }
export type LedgerPrice = { symbol_id: string | number; trading_date: string; close: number; valuation_usable?:boolean }
export type LedgerReport = { portfolio: { capital: number; created_at?: string; initial_capital?: number }; initial_capital?: number; transactions: LedgerTransaction[]; capital_movements: CapitalMovement[]; prices: LedgerPrice[]; valuation_blocked_symbols?: number[]; valuation_issues?: {symbol_id:number;symbol:string;ex_date:string;action_type:string}[]; market_sessions?: string[]; as_of_date?:string }
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
  const transactions = report.transactions.filter(item=>!report.as_of_date||item.trading_date<=report.as_of_date).sort(chronological)
  const movements = report.capital_movements.filter(item=>!report.as_of_date||item.effective_date<=report.as_of_date).sort((a, b) => a.effective_date.localeCompare(b.effective_date) || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))
  const signed = (item: CapitalMovement) => (item.movement_type === 'DEPOSIT' ? 1 : -1) * Number(item.amount)
  const initialCapital = Number(report.initial_capital ?? report.portfolio.initial_capital ?? (Number(report.portfolio.capital) - report.capital_movements.reduce((sum, item) => sum + signed(item), 0)))
  const eventDates = [...transactions.map(item => item.trading_date), ...movements.map(item => item.effective_date)]
  const createdAt = report.portfolio.created_at ? new Date(report.portfolio.created_at) : null
  const createdDate = createdAt && !Number.isNaN(createdAt.getTime()) ? todayInVietnam(createdAt) : undefined
  const firstDate = [...eventDates, ...(createdDate ? [createdDate] : [])].sort()[0] ?? report.prices.map(item => item.trading_date).sort()[0]
  if (!firstDate) return []
  const sessions=[...new Set(report.market_sessions?.length?report.market_sessions:report.prices.map(row=>row.trading_date))].sort()
  const dates = [...new Set([firstDate, ...eventDates, ...report.prices.map(item => item.trading_date),...sessions,...(report.as_of_date?[report.as_of_date]:[])])].filter(date => date >= firstDate&&(!report.as_of_date||date<=report.as_of_date)).sort()
  const pricesByDate: Record<string, LedgerPrice[]> = {}
  for (const row of report.prices) (pricesByDate[row.trading_date] ??= []).push(row)
  const holdings: Record<string, { quantity: number; cost: number }> = {}
  const marks: Record<string, { value: number; date: string; usable:boolean }> = {}
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
    for (const row of pricesByDate[date] ?? []) marks[String(row.symbol_id)] = { value: Number(row.close) * 1000, date, usable:row.valuation_usable!==false }
    let missingPrices = 0, stalePrices = 0, unverifiedPrices=0
    const expectedSession=report.market_sessions ? sessions.filter(session=>session<=date).at(-1) : date
    const marketValue = Object.entries(holdings).reduce((sum, [key, held]) => {
      const mark = marks[key]
      if (!mark) missingPrices += 1
      else if (expectedSession && mark.date < expectedSession) stalePrices += 1
      if (mark&&!mark.usable) unverifiedPrices+=1
      return sum + held.quantity * (mark?.value ?? held.cost / held.quantity)
    }, 0)
    const nav = cash + marketValue
    // Contributions/withdrawals are assumed at the beginning of their effective day.
    const denominator = previousNav + flow
    const dailyReturn = denominator > 0 ? nav / denominator - 1 : null
    if (dailyReturn != null) growth *= 1 + dailyReturn
    previousNav = nav
    const blocked=report.valuation_issues?.some(issue=>issue.ex_date<=date)??Boolean(report.valuation_blocked_symbols?.length)
    return { date, nav, cash, capital, marketValue, netFlow: flow, value: (growth - 1) * 100, dailyReturn, missingPrices, stalePrices, unverifiedPrices, valuationComplete:!blocked&&!missingPrices&&!stalePrices&&!unverifiedPrices }
  })
}

export function portfolioPerformance(report:LedgerReport,rates:CostRate[]=[]) {
  const timeline=portfolioTimeline(report,rates),latest=timeline.at(-1),previous=timeline.at(-2)
  const complete=Boolean(latest?.valuationComplete),dailyComplete=complete&&(!previous||previous.valuationComplete)
  const todayProfitLoss=dailyComplete&&latest?latest.nav-(previous?.nav??0)-latest.netFlow:null
  const dailyBase=(previous?.nav??0)+(latest?.netFlow??0)
  const sessionDates=new Set(report.market_sessions?.length?report.market_sessions:report.prices.map(row=>row.trading_date))
  const eligible=timeline.filter(row=>sessionDates.has(row.date))
  const samples=eligible.length?eligible:timeline.filter(row=>row.date===(report.as_of_date??latest?.date))
  const verified=samples.filter(row=>row.valuationComplete)
  const averageNetAssets=verified.length?verified.reduce((sum,row)=>sum+row.nav,0)/verified.length:null
  const lastPriceDate=report.prices.map(row=>row.trading_date).filter(date=>!report.as_of_date||date<=report.as_of_date).sort().at(-1)??null
  return {timeline,latest,complete,profitLoss:complete&&latest?latest.nav-latest.capital:null,
    returnPct:complete&&timeline.every(row=>row.valuationComplete)?latest?.value??null:null,
    todayProfitLoss,todayReturnPct:todayProfitLoss!=null&&dailyBase>0?todayProfitLoss/dailyBase*100:null,
    averageNetAssets,averageSamples:verified.length,averageTotal:samples.length,lastPriceDate}
}
