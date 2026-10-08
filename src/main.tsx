import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthGate, type UserProfile } from './AuthGate'
import './styles.css'
import './overview-screener.css'
import './light-theme.css'
import './ui-polish.css'
import './signal-controls.css'
import './v4-design.css'
import './layout-refinement.css'
import { initializeTheme } from './lib/theme'
import { initializeInputModality } from './lib/inputModality'

initializeTheme()
initializeInputModality()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

// A different account mounts a different cache and component tree.
function SessionApplication({ authenticated, profile }: { authenticated: boolean; profile: UserProfile | null }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000, refetchOnWindowFocus: true } } }), [])
  return <QueryClientProvider client={queryClient}><App authenticated={authenticated} profile={profile}/></QueryClientProvider>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>{(authenticated, profile) => <SessionApplication key={profile?.user_id ?? 'disconnected'} authenticated={authenticated} profile={profile}/>}</AuthGate>
  </StrictMode>,
)
