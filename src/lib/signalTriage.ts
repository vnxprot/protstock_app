export type TriageSignal = {
  signal_id: string
  symbol_id: number
  symbol: string
  sector: string | null
  as_of_date: string
  timeframe: string
  action: string
  state: string
  score: number
  reasons: string[]
}

export type SignalGroup<T extends TriageSignal> = {
  symbol: string
  symbol_id: number
  sector: string | null
  signals: T[]
  primary: T
  held: boolean
  change: 'new' | 'action' | 'reasons' | 'continued' | 'unknown'
  risk: boolean
  opportunity: boolean
  priority: number
}

export type TriageFocus = 'all' | 'changed' | 'held_risk' | 'opportunity' | 'other'
export type TriageHolding = 'all' | 'held' | 'unheld'

export function filterSignalGroups<T extends TriageSignal>(
  groups: SignalGroup<T>[], focus: TriageFocus, holding: TriageHolding,
): SignalGroup<T>[] {
  return groups.filter(group => {
    if (holding === 'held' && !group.held || holding === 'unheld' && group.held) return false
    const changed = group.change === 'new' || group.change === 'action' || group.change === 'reasons'
    const heldRisk = group.held && (group.risk || group.signals.some(signal => signal.action === 'EXIT' || signal.action === 'REDUCE'))
    if (focus === 'changed') return changed
    if (focus === 'held_risk') return heldRisk
    if (focus === 'opportunity') return group.opportunity
    if (focus === 'other') return !changed && !heldRisk && !group.opportunity
    return true
  })
}

export function signalGroupPage<T extends TriageSignal>(groups: SignalGroup<T>[], page: number, pageSize = 10): SignalGroup<T>[] {
  const start = (Math.max(1, page) - 1) * pageSize
  return groups.slice(start, start + pageSize)
}

const actionRank: Record<string, number> = { EXIT: 5, REDUCE: 4, ADD: 3, PROBE_BUY: 2, WATCH: 1 }
const riskReasons = new Set([
  'TREND_DOWN', 'MONTHLY_BEARISH', 'OPPOSING_BEARISH_READY',
  'OPPOSING_BEARISH_CONFIRMED', 'FLOW_BAR_SELLING_PRESSURE',
  'WYCKOFF_UTAD', 'WYCKOFF_SOW', 'WYCKOFF_DISTRIBUTION_CONTEXT',
  'STOP_INVALIDATED',
])
const opportunityReasons = new Set([
  'WEEKLY_BULLISH_SETUP', 'WYCKOFF_SPRING',
])

function signature<T extends TriageSignal>(signals: T[], includeReasons: boolean): string {
  return signals.map(signal => [signal.timeframe, signal.action, signal.state,
    includeReasons ? [...new Set(signal.reasons)].sort().join(',') : '',
  ].join(':')).sort().join('|')
}

export function groupSignals<T extends TriageSignal>(
  signals: T[], previous: TriageSignal[] | null, heldIds: ReadonlySet<number>,
): SignalGroup<T>[] {
  const prior = new Map<number, TriageSignal[]>()
  previous?.forEach(signal => prior.set(signal.symbol_id, [...(prior.get(signal.symbol_id) ?? []), signal]))
  const bySymbol = new Map<number, T[]>()
  signals.forEach(signal => bySymbol.set(signal.symbol_id, [...(bySymbol.get(signal.symbol_id) ?? []), signal]))

  return [...bySymbol.values()].map(items => {
    const ordered = [...items].sort((a, b) => (actionRank[b.action] ?? 0) - (actionRank[a.action] ?? 0)
      || b.score - a.score || a.timeframe.localeCompare(b.timeframe))
    const primary = ordered[0]
    const held = heldIds.has(primary.symbol_id)
    const previousItems = prior.get(primary.symbol_id)
    const change: SignalGroup<T>['change'] = previous === null ? 'unknown'
      : !previousItems ? 'new'
      : signature(items, false) !== signature(previousItems, false) ? 'action'
      : signature(items, true) !== signature(previousItems, true) ? 'reasons'
      : 'continued'
    const watches = items.filter(signal => signal.action === 'WATCH')
    const risk = watches.some(signal => signal.reasons.some(reason => riskReasons.has(reason.replace(/^(CORE_V1_|V0_)/, ''))))
    const opportunity = watches.some(signal => signal.state === 'WATCH_SETUP'
      || signal.reasons.some(reason => {
        const code = reason.replace(/^(CORE_V1_|V0_)/, '')
        return opportunityReasons.has(code) || code.startsWith('NEAR_TRIGGER_') || code.startsWith('NEAR_')
      }))
    const hasSell = items.some(signal => signal.action === 'EXIT' || signal.action === 'REDUCE')
    const changed = change === 'new' || change === 'action' || change === 'reasons'
    const priority = (changed ? 300 : held && (risk || hasSell) ? 200 : opportunity ? 100 : 0)
      + (held && hasSell ? 40 : hasSell ? 30 : held ? 20 : 0)
      + (change === 'new' || change === 'action' ? 10 : change === 'reasons' ? 5 : 0)
    return { symbol: primary.symbol, symbol_id: primary.symbol_id, sector: primary.sector,
      signals: ordered, primary, held, change, risk, opportunity, priority }
  }).sort((a, b) => b.priority - a.priority || b.primary.score - a.primary.score || a.symbol.localeCompare(b.symbol))
}
