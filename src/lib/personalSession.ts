import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useAccountId(authenticated: boolean) {
  const [userId, setUserId] = useState<string | null>(null)
  useEffect(() => {
    if (!authenticated || !supabase) { setUserId(null); return }
    let live = true
    void supabase.auth.getSession().then(({ data }) => { if (live) setUserId(data.session?.user.id ?? null) })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null))
    return () => { live = false; data.subscription.unsubscribe() }
  }, [authenticated])
  return userId
}
