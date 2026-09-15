import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' }
const emailFor = (username: string) => `${username.toLowerCase().trim()}@protstock.local`
Deno.serve(async request => { try {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = request.headers.get('Authorization') ?? ''
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: caller } = await client.auth.getUser()
  if (!caller.user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
  const { data: profile } = await client.from('user_profiles').select('role,status').eq('user_id', caller.user.id).maybeSingle()
  if (profile?.role !== 'ADMIN' || profile.status !== 'ACTIVE') return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await request.json(); const action = body.action
  if (action === 'create') {
    const username = String(body.username ?? '').toLowerCase().trim(); const password = String(body.password ?? ''); const fullName = String(body.full_name ?? '').trim()
    if (!/^[a-z0-9_]{3,32}$/.test(username) || !password || !fullName) return Response.json({ error: 'Invalid account details' }, { status: 400, headers: cors })
    const { data, error } = await admin.auth.admin.createUser({ email: emailFor(username), password, email_confirm: true, user_metadata: { username, full_name: fullName } })
    if (error || !data.user) return Response.json({ error: error?.message ?? 'Create failed' }, { status: 400, headers: cors })
    const { error: profileError } = await admin.from('user_profiles').insert({ user_id: data.user.id, username, full_name: fullName, role: 'CLIENT', status: 'ACTIVE' })
    if (profileError) { await admin.auth.admin.deleteUser(data.user.id); return Response.json({ error: profileError.message }, { status: 400, headers: cors }) }
    return Response.json({ ok: true }, { headers: cors })
  }
  if (action === 'status') { const { error } = await admin.from('user_profiles').update({ status: body.status }).eq('user_id', body.user_id); if (error) return Response.json({ error: error.message }, { status: 400, headers: cors }); if (body.status !== 'ACTIVE') await admin.auth.admin.signOut(body.user_id, 'global'); return Response.json({ ok: true }, { headers: cors }) }
  if (action === 'signout_all') { const { error } = await admin.auth.admin.signOut(body.user_id, 'global'); if (error) return Response.json({ error: error.message }, { status: 400, headers: cors }); await admin.from('user_active_sessions').delete().eq('user_id', body.user_id); return Response.json({ ok: true }, { headers: cors }) }
  return Response.json({ error: 'Unknown action' }, { status: 400, headers: cors })
} catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unexpected error' }, { status: 500, headers: cors }) } })
