// Development-only browser fixture; excluded from the production entry point.
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../src/App'
import type { UserProfile } from '../src/AuthGate'
let root: Root | null = null
export function mountUiFixture(role: 'ADMIN' | 'CLIENT' = 'ADMIN') {
  root?.unmount()
  document.getElementById('root')!.style.display = 'none'
  const host = document.getElementById('ui-test') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'ui-test' }))
  root = createRoot(host)
  const profile: UserProfile = { user_id: '11111111-1111-1111-1111-111111111111', username: 'prot', full_name: 'Prot', role, status: 'ACTIVE', last_seen_at: null }
  root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(App, { authenticated: false, profile })))
}
