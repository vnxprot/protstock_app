// Original holdings-table denominator: recorded cash plus all current position values.
export function holdingsNetAssetValue(holdings: {marketValue:number}[], cash:number) {
  return cash+holdings.reduce((total,h)=>total+h.marketValue,0)
}
