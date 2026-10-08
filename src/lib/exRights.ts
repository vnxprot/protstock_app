export type ExRightsInput = {
  price: number
  cash: number
  stockRate: number
  rightsRate: number
  rightsPrice: number
  splitRate: number
}

export function calculateExRights(input: ExRightsInput) {
  const { price, cash, stockRate, rightsRate, rightsPrice, splitRate } = input
  if (![price, cash, stockRate, rightsRate, rightsPrice, splitRate].every(Number.isFinite)
    || price <= 0 || cash < 0 || stockRate < 0 || rightsRate < 0 || rightsPrice < 0 || splitRate <= 0) return null
  if (cash >= price) return null
  if (rightsRate > 0 && rightsPrice <= 0) return null
  const numerator = price - cash + rightsRate * rightsPrice
  const denominator = (1 + stockRate + rightsRate) * splitRate
  const result = numerator / denominator
  return Number.isFinite(result) && result > 0 ? result : null
}
