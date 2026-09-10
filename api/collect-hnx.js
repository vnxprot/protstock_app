const RSS_URL = 'http://www.hnx.vn:7978/3/vi_vn/thong-tin-cong-bo-tu-to-chuc-phat-hanh.rss'
const HOSE_RSS_URL = 'https://api.hsx.vn/n/api/v1/News/NewsByCateFeed/21'

function xmlValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? match[1].trim().replace(/&amp;/g, '&') : ''
}

function cleanTitle(value) {
  return value.replace(/&lt;[^&]*&gt;/g, '').replace(/<[^>]*>/g, '').trim()
}

function parseFeed(xml, source, symbolMap) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []
  return blocks.map(block => {
    const title = cleanTitle(xmlValue(block, 'title')), source_reference = xmlValue(block, 'guid'), source_url = xmlValue(block, 'link')
    const dateValue = source === 'HOSE' ? xmlValue(block, 'a10:updated') : xmlValue(block, 'pubDate')
    const published = new Date(dateValue)
    const ticker = (title.match(/\b[A-Z]{3,10}\b/g) ?? []).find(code => symbolMap.has(code))
    return { source, source_reference, symbol_id: ticker ? symbolMap.get(ticker) : null, category: `${source}_ISSUER_RSS`, title, published_at: published.toISOString(), available_from: published.toISOString().slice(0, 10), source_url }
  }).filter(row => row.source_reference && row.title && row.source_url && !Number.isNaN(new Date(row.published_at).valueOf()))
}

export default async function handler(request, response) {
  if (process.env.CRON_SECRET && request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ error: 'unauthorized' })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return response.status(503).json({ error: 'missing Supabase server credentials' })
  try {
    const [hnxRss, hoseRss, symbols] = await Promise.all([
      fetch(RSS_URL, { headers: { 'User-Agent': 'ProtStock/1.0' }, signal: AbortSignal.timeout(45_000) }),
      fetch(HOSE_RSS_URL, { headers: { 'User-Agent': 'ProtStock/1.0' }, signal: AbortSignal.timeout(45_000) }),
      fetch(`${url}/rest/v1/symbols?select=id,symbol&active=eq.true`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }),
    ])
    if (!hnxRss.ok || !hoseRss.ok || !symbols.ok) throw new Error(`upstream HNX=${hnxRss.status} HOSE=${hoseRss.status} symbols=${symbols.status}`)
    const symbolMap = new Map((await symbols.json()).map(row => [row.symbol, row.id]))
    const rows = [
      ...parseFeed(await hnxRss.text(), 'HNX', symbolMap),
      ...parseFeed(await hoseRss.text(), 'HOSE', symbolMap),
    ]
    const saved = await fetch(`${url}/rest/v1/disclosures?on_conflict=source,source_reference`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) })
    if (!saved.ok) throw new Error(`Supabase write ${saved.status}: ${await saved.text()}`)
    return response.status(200).json({ status: 'SUCCEEDED', source: 'HNX_HOSE_RSS', disclosures: rows.length })
  } catch (error) { return response.status(502).json({ status: 'FAILED', error: error instanceof Error ? error.message : 'unknown' }) }
}
