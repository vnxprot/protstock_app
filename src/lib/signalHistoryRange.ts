export const signalHistoryRanges = ['ALL','1D','7D','14D','30D','60D','90D','1Y'] as const
export type SignalHistoryRange = typeof signalHistoryRanges[number] | 'CUSTOM'

// 1D means the latest published trading session. Longer ranges are calendar days,
// inclusive of that session, so weekends never shift the end to an empty day.
export function signalHistoryWindow(range: SignalHistoryRange, latestDate: string | null) {
  if (range === 'CUSTOM') return null
  if (range === '1D' || range === 'ALL') return {showHistory:range !== '1D',dateFrom:'',dateTo:''}
  if (!latestDate) return null
  const start = new Date(`${latestDate}T00:00:00Z`)
  if (range === '1Y') start.setUTCFullYear(start.getUTCFullYear()-1)
  else start.setUTCDate(start.getUTCDate()-(Number(range.slice(0,-1))-1))
  return {showHistory:true,dateFrom:start.toISOString().slice(0,10),dateTo:latestDate}
}
