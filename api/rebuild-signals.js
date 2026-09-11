const OWNER_EMAIL = 'prot@protstock.local'
const WORKFLOW_URL = 'https://api.github.com/repos/vnxprot/protstock_app/actions/workflows/rebuild-signals.yml/dispatches'

async function authenticatedOwner(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!token || !supabaseUrl || !serviceRoleKey) return false
  const user = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${token}` },
  })
  if (!user.ok) return false
  return (await user.json()).email === OWNER_EMAIL
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'method_not_allowed' })
  try {
    if (!await authenticatedOwner(request)) return response.status(401).json({ error: 'unauthorized' })
    const token = process.env.GITHUB_ACTIONS_TOKEN
    if (!token) return response.status(503).json({ error: 'signal_runner_not_configured' })
    const { tradingDate, sendTelegram = false } = request.body ?? {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate ?? '')) return response.status(400).json({ error: 'invalid_trading_date' })
    const dispatched = await fetch(WORKFLOW_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { trading_date: tradingDate, send_telegram: Boolean(sendTelegram) } }),
    })
    if (!dispatched.ok) throw new Error(`GitHub dispatch failed (${dispatched.status})`)
    return response.status(202).json({ status: 'QUEUED', tradingDate, telegram: Boolean(sendTelegram) })
  } catch (error) {
    return response.status(502).json({ error: 'signal_dispatch_failed', detail: error instanceof Error ? error.message : 'unknown' })
  }
}
