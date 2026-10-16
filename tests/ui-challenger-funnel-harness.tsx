// Local browser regression fixture; never imported by the production entry point.
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChallengerFunnelTable } from '../src/components/ChallengerFunnelTable'
import { SignalFunnelPanel } from '../src/components/SignalFunnelPanel'
let root: Root | null = null
export function mountFunnelFixture() {
  root?.unmount()
  document.getElementById('root')!.style.display = 'none'
  const host = document.getElementById('funnel-test') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'funnel-test' }))
  host.className = 'app-shell'
  host.style.cssText = 'display:block;padding:16px;max-width:1400px;margin:auto'
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['challenger-funnel-overview', '2026-10-15'], Array.from({ length: 25 }, (_, i) => ({
    symbol_id: i + 1, symbol: `S${String(i + 1).padStart(2, '0')}`, action: 'WATCH', reasons: [], base_price: 30, invalidation_price: 28,
    evidence: { funnel_stage: 'WEEKLY_READY', monthly_state: 'UP', weekly_setup: 'WEEKLY_PULLBACK_EMA20', setup_date: '2026-10-09',
      monthly: { policy_version: 'fixture', state: 'UP', period_end: '2026-09-30', history_months: 60,
        entry_up_checks: { price_above_ema: true, ema_above_sma: true, persistence: true, slope: true },
        entry_down_checks: { price_below_ema: false, ema_below_sma: false, persistence: false, slope: false } } },
  })))
  root = createRoot(host)
  root.render(<QueryClientProvider client={client}><SignalFunnelPanel date="2026-10-15" authenticated={false}/><ChallengerFunnelTable date="2026-10-15"/></QueryClientProvider>)
}
