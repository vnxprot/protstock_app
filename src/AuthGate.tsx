import { Eye, EyeOff } from 'lucide-react'
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
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
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reload, setReload] = useState(0)
  const currentUser = useRef<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    const authClient = supabase
    let generation = 0; let disposed = false
    const load = async (nextSession: Session | null, event?: string) => {
      const request = ++generation
      if (disposed) return
      setSession(nextSession)
      if (!nextSession) { currentUser.current = null; setProfile(null); setLoading(false); return }
      if (currentUser.current !== nextSession.user.id) { setProfile(null); setLoading(true); currentUser.current = nextSession.user.id }
      const { data, error } = await authClient.from('user_profiles').select('user_id,username,full_name,role,status,last_seen_at').eq('user_id', nextSession.user.id).maybeSingle()
      if (disposed || generation !== request) return
      if (error) { setMessage('Chưa kiểm tra được quyền tài khoản. Hãy thử lại khi kết nối ổn định.'); setProfile(null); setLoading(false); return }
      if (!data || data.status !== 'ACTIVE') { await authClient.auth.signOut(); setMessage('Tài khoản chưa được kích hoạt hoặc đã bị khóa.'); setProfile(null); setLoading(false); return }
      const current = data as UserProfile; setProfile(current); setMessage('')
      let sessionId = nextSession.user.id
      try { const payload = JSON.parse(atob(nextSession.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); sessionId = payload.session_id ?? sessionId } catch { /* Older sessions may omit session_id. */ }
      void authClient.rpc('record_session_presence', { p_session_id: sessionId, p_event: event === 'SIGNED_IN' ? 'LOGIN' : 'SEEN', p_user_agent: navigator.userAgent })
      setLoading(false)
    }
    authClient.auth.getSession().then(({ data }) => void load(data.session))
    const { data } = authClient.auth.onAuthStateChange((event, nextSession) => {
      // Start database work outside the auth callback lock.
      setTimeout(() => void load(nextSession, event), 0)
    })
    return () => { disposed = true; generation++; data.subscription.unsubscribe() }
  }, [reload])

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
  if (session && message) return <main className="auth-screen"><section className="auth-card"><h1>Kiểm tra kết nối</h1><p role="alert">{message}</p><button className="primary-button" onClick={() => { setLoading(true); setReload(value => value + 1) }}>Thử lại</button><button className="text-button" onClick={() => void supabase?.auth.signOut()}>Đăng xuất</button></section></main>

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
          <span className="password-input auth-password-input"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span>
          <button type="submit" disabled={submitting}>{submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
        </form>
        {message && <p className="auth-message" role="status">{message}</p>}
      </section>
    </main>
  )
}
