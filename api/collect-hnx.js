const RSS_URL = 'http://www.hnx.vn:7978/3/vi_vn/thong-tin-cong-bo-tu-to-chuc-phat-hanh.rss'

function xmlValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? match[1].trim().replace(/&amp;/g, '&') : ''
}

export default async function handler(request, response) {
  if (process.env.CRON_SECRET && request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ error: 'unauthorized' })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return response.status(503).json({ error: 'missing Supabase server credentials' })
  try {
    const [rss, symbols] = await Promise.all([
      fetch(RSS_URL, { headers: { 'User-Agent': 'ProtStock/1.0' }, signal: AbortSignal.timeout(45_000) }),
      fetch(`${url}/rest/v1/symbols?select=id,symbol&active=eq.true`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }),
    ])
    if (!rss.ok || !symbols.ok) throw new Error(`upstream ${rss.status}/${symbols.status}`)
    const symbolMap = new Map((await symbols.json()).map(row => [row.symbol, row.id]))
    const blocks = (await rss.text()).match(/<item>[\s\S]*?<\/item>/gi) ?? []
    const rows = blocks.map(block => {
      const title = xmlValue(block, 'title'), source_reference = xmlValue(block, 'guid'), source_url = xmlValue(block, 'link')
      const published = new Date(xmlValue(block, 'pubDate'))
      const ticker = (title.match(/\b[A-Z]{3,10}\b/g) ?? []).find(code => symbolMap.has(code))
      return { source: 'HNX', source_reference, symbol_id: ticker ? symbolMap.get(ticker) : null, category: 'HNX_ISSUER_RSS', title, published_at: published.toISOString(), available_from: published.toISOString().slice(0, 10), source_url }
    }).filter(row => row.source_reference && row.title && row.source_url)
    const saved = await fetch(`${url}/rest/v1/disclosures?on_conflict=source,source_reference`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) })
    if (!saved.ok) throw new Error(`Supabase write ${saved.status}: ${await saved.text()}`)
    return response.status(200).json({ status: 'SUCCEEDED', source: 'HNX_RSS', disclosures: rows.length })
  } catch (error) { return response.status(502).json({ status: 'FAILED', error: error instanceof Error ? error.message : 'unknown' }) }
}
