export const COST_START_DATE = '2026-09-01'
export const SSI_DEFAULT_RATE: CostRate = {
  effective_date: COST_START_DATE,
  buy_fee_pct: 0.15,
  sell_fee_pct: 0.15,
  sell_tax_pct: 0.1,
  source_note: 'SSI, giao dịch chủ động online dưới 100 triệu đồng/ngày/tài khoản; thuế TNCN theo quy định hiện hành.',
}

export type CostRate = {
  effective_date: string
  buy_fee_pct: number
  sell_fee_pct: number
  sell_tax_pct: number
  source_note?: string | null
}

export type CostedTrade = {
  trading_date: string
  action: string
  quantity: number
  price: number | null
  broker_fee_override?: number | null
  sell_tax_override?: number | null
}

export function rateOn(date: string, rates: CostRate[] = []): CostRate | null {
  if (date < COST_START_DATE) return null
  return [SSI_DEFAULT_RATE, ...rates].filter(rate => rate.effective_date <= date)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date)).at(-1)!
}

export function tradeCosts(trade: CostedTrade, rates: CostRate[] = []) {
  const isBuy = trade.action === 'BUY_NEW' || trade.action === 'BUY_ADD'
  const isSell = trade.action === 'SELL_REDUCE' || trade.action === 'SELL_CLOSE'
  if ((!isBuy && !isSell) || trade.trading_date < COST_START_DATE) return { brokerFee: 0, sellTax: 0, total: 0 }
  const gross = Number(trade.quantity) * Number(trade.price ?? 0)
  const rate = rateOn(trade.trading_date, rates)!
  const brokerFee = trade.broker_fee_override == null
    ? Math.round(gross * (isBuy ? rate.buy_fee_pct : rate.sell_fee_pct) / 100)
    : Number(trade.broker_fee_override)
  const sellTax = !isSell ? 0 : trade.sell_tax_override == null
    ? Math.round(gross * rate.sell_tax_pct / 100)
    : Number(trade.sell_tax_override)
  return { brokerFee, sellTax, total: brokerFee + sellTax }
}
