import { FormEvent, ReactNode, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'

import { isSupabaseConfigured, supabase } from './lib/supabase'

interface AuthGateProps {
  children: (authenticated: boolean) => ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!supabase || username.trim().toLowerCase() !== 'prot' || !password) {
      setMessage('Tên đăng nhập hoặc mật khẩu không đúng.')
      return
    }
    setSubmitting(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({
      // Supabase Auth requires an email identifier. This is a private internal alias,
      // never shown in the UI and does not require access to an inbox.
      email: 'prot@protstock.local',
      password,
    })
    setMessage(error ? 'Tên đăng nhập hoặc mật khẩu không đúng.' : '')
    setSubmitting(false)
  }

  if (!isSupabaseConfigured) return <>{children(false)}</>
  if (loading) return <div className="auth-screen"><div className="auth-card">Đang kiểm tra phiên đăng nhập…</div></div>
  if (session) return <>{children(true)}</>

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="login-title">
        <span className="brand-mark">P</span>
        <span className="eyebrow">PRIVATE ACCESS</span>
        <h1 id="login-title">Prot Stock</h1>
        <p>Khu vực riêng của Prot.</p>
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
