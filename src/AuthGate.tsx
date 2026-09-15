import { FormEvent, ReactNode, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'

import { isSupabaseConfigured, supabase } from './lib/supabase'
import { ThemeToggle } from './components/ThemeToggle'

interface AuthGateProps {
  children: (authenticated: boolean, profile: UserProfile | null) => ReactNode
}
export type UserProfile = { user_id: string; username: string; full_name: string; role: 'ADMIN' | 'CLIENT'; status: string; last_seen_at: string | null }

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const authClient = supabase
    const load = async (nextSession: Session | null, event?: string) => {
      setSession(nextSession)
      if (!nextSession) { setProfile(null); setLoading(false); return }
      const { data } = await authClient.from('user_profiles').select('user_id,username,full_name,role,status,last_seen_at').eq('user_id', nextSession.user.id).maybeSingle()
      if (!data || data.status !== 'ACTIVE') { await authClient.auth.signOut(); setMessage('Tài khoản chưa được kích hoạt hoặc đã bị khóa.'); setProfile(null); setLoading(false); return }
      const current = data as UserProfile; setProfile(current)
      const sessionId = String((nextSession as any).access_token?.split('.')[1] ?? nextSession.user.id).slice(0, 180)
      void authClient.rpc('record_session_presence', { p_session_id: sessionId, p_event: event === 'SIGNED_IN' ? 'LOGIN' : 'SEEN', p_user_agent: navigator.userAgent })
      setLoading(false)
    }
    authClient.auth.getSession().then(({ data }) => void load(data.session))
    const { data } = authClient.auth.onAuthStateChange((event, nextSession) => {
      void load(nextSession, event)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function signIn(event: FormEvent) {
    event.preventDefault()
    const normalized = username.trim().toLowerCase()
    if (!supabase || !/^[a-z0-9_]{3,32}$/.test(normalized) || !password) {
      setMessage('Tên đăng nhập hoặc mật khẩu không đúng.')
      return
    }
    setSubmitting(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({
      // The interface remains username/password; this internal alias is never shown.
      email: `${normalized}@protstock.local`,
      password,
    })
    setMessage(error ? 'Tên đăng nhập hoặc mật khẩu không đúng.' : '')
    setSubmitting(false)
  }

  if (!isSupabaseConfigured) return <>{children(false, null)}</>
  if (loading) return <div className="auth-screen"><div className="auth-card">Đang kiểm tra phiên đăng nhập…</div></div>
  if (session && profile) return <>{children(true, profile)}</>

  return (
    <main className="auth-screen">
      <div className="auth-theme-toggle"><ThemeToggle/></div>
      <section className="auth-card" aria-labelledby="login-title">
        <span className="brand-mark">P</span>
        <span className="eyebrow">TRUY CẬP RIÊNG</span>
        <h1 id="login-title">Prot Stock</h1>
        <p>Khu vực dữ liệu và tín hiệu Prot Stock.</p>
        <form onSubmit={signIn}>
          <label htmlFor="username">Tên đăng nhập</label>
          <input id="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="prot" />
          <label htmlFor="password">Mật khẩu</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="submit" disabled={submitting}>{submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
        </form>
        {message && <p className="auth-message" role="status">{message}</p>}
      </section>
    </main>
  )
}
