import { FormEvent, ReactNode, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'

import { isSupabaseConfigured, supabase } from './lib/supabase'

interface AuthGateProps {
  children: (authenticated: boolean) => ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [email, setEmail] = useState('')
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

  async function requestMagicLink(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !email.trim()) return
    setSubmitting(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    })
    setMessage(error ? 'Không thể gửi liên kết đăng nhập.' : 'Đã gửi liên kết đăng nhập. Kiểm tra email của Prot.')
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
        <p>Đăng nhập bằng liên kết một lần. App không lưu mật khẩu.</p>
        <form onSubmit={requestMagicLink}>
          <label htmlFor="email">Email của Prot</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="prot@example.com" />
          <button type="submit" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi liên kết đăng nhập'}</button>
        </form>
        {message && <p className="auth-message" role="status">{message}</p>}
      </section>
    </main>
  )
}
