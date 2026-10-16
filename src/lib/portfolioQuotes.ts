// Never normalize weights over just the priced subset, or substitute cost for a missing quote.
export function quotedNetAssetValue(holdings: {quantity:number;marketPrice:number|null}[], cash:number|null) {
  if (cash==null||!Number.isFinite(cash)||holdings.some(h=>h.quantity>0&&(h.marketPrice==null||!Number.isFinite(h.marketPrice)||h.marketPrice<=0))) return null
  return cash+holdings.reduce((total,h)=>total+(h.quantity>0?h.quantity*h.marketPrice!:0),0)
}
