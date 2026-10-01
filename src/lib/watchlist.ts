import { useEffect, useState } from 'react'
type WatchlistClient = NonNullable<typeof import('./supabase').supabase>

export type WatchTier = 'B' | 'A' | 'S'
export type WatchItem = { symbol: string; tier: WatchTier; addedAt: string }
const WATCHLIST_KEY = 'protstock-watchlist-v1'
const LEGACY_KEY = 'protstock-favorites'
const LEGACY_OWNER_KEY = 'protstock-watchlist-legacy-owner'
const RETIRED_SYMBOLS = new Set(['DHM', 'LTG', 'DMC', 'POS', 'MTA', 'AMC', 'DHD'])
let activeUserId: string | null = null
let cloudClient: WatchlistClient | null = null
let activeEpoch = 0
let bootPromise: Promise<void> | null = null
let pendingChanges: { userId: string; symbol: string; tier: WatchTier; remove: boolean }[] = []
let processingChanges = false
let syncStatus: 'loading' | 'ready' | 'error' = 'loading'
const accountKey = () => activeUserId ? `${WATCHLIST_KEY}:${activeUserId}` : WATCHLIST_KEY
function setSyncStatus(status: typeof syncStatus) {
  syncStatus = status
  dispatchEvent(new CustomEvent('protstock:watchlist-sync', { detail: status }))
}
const validTier = (value: unknown): value is WatchTier => value === 'B' || value === 'A' || value === 'S'
const validSymbol = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9]{2,8}$/.test(value)

export function normalizeWatchlist(value: unknown): WatchItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(item => {
    const symbol = typeof item === 'string' ? item : item?.symbol
    if (!validSymbol(symbol) || RETIRED_SYMBOLS.has(symbol) || seen.has(symbol)) return []
    seen.add(symbol)
    return [{ symbol, tier: validTier(item?.tier) ? item.tier : 'B', addedAt: typeof item?.addedAt === 'string' ? item.addedAt : '' }]
  })
}

export function loadWatchlist(): WatchItem[] {
  try {
    const stored = localStorage.getItem(accountKey())
    if (stored !== null) return normalizeWatchlist(JSON.parse(stored))
    if (activeUserId) {
      const owner = localStorage.getItem(LEGACY_OWNER_KEY)
      if (owner && owner !== activeUserId) return []
      localStorage.setItem(LEGACY_OWNER_KEY, activeUserId)
    }
    const migrated = normalizeWatchlist(JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? localStorage.getItem(LEGACY_KEY) ?? '[]'))
    localStorage.setItem(accountKey(), JSON.stringify(migrated))
    return migrated
  } catch { return [] }
}

export function saveWatchlist(value: WatchItem[]): WatchItem[] {
  const items = normalizeWatchlist(value)
  localStorage.setItem(accountKey(), JSON.stringify(items))
  const symbols = items.map(item => item.symbol)
  localStorage.setItem(LEGACY_KEY, JSON.stringify(symbols))
  dispatchEvent(new CustomEvent('protstock:watchlist', { detail: items }))
  dispatchEvent(new CustomEvent('protstock:favorites', { detail: symbols }))
  return items
}

export function toggleWatchlistSymbol(symbol: string): WatchItem[] {
  const items = loadWatchlist()
  const remove = items.some(item => item.symbol === symbol)
  const next = saveWatchlist(remove
    ? items.filter(item => item.symbol !== symbol)
    : [{ symbol, tier: 'B', addedAt: new Date().toISOString() }, ...items])
  queueChange(symbol, 'B', remove)
  return next
}

export function setWatchlistTier(symbol: string, tier: WatchTier): WatchItem[] {
  const items = loadWatchlist()
  if (!items.some(item => item.symbol === symbol)) return items
  const next = saveWatchlist(items.map(item => item.symbol === symbol ? { ...item, tier } : item))
  queueChange(symbol, tier, false)
  return next
}

async function initializeCloud(userId: string): Promise<void> {
  const client = cloudClient
  if (!client || activeUserId !== userId) return
  if (bootPromise) return bootPromise
  const epoch = activeEpoch
  const promise = (async () => {
    const localItems = loadWatchlist()
    const { data: existing, error: readError } = await client.from('user_watchlists').select('items,legacy_imported').eq('user_id', userId).maybeSingle()
    if (readError) throw readError
    if (!existing) {
      const { error: insertError } = await client.from('user_watchlists').insert({ user_id: userId, items: localItems, legacy_imported: localItems.length > 0 })
      if (insertError && insertError.code !== '23505') throw insertError
    }
    if (localItems.length && (!existing || !existing.legacy_imported)) {
      const { error: claimError } = await client.from('user_watchlists')
        .update({ items: localItems, legacy_imported: true }).eq('user_id', userId).eq('legacy_imported', false)
      if (claimError) throw claimError
    }
    const { data, error } = await client.from('user_watchlists').select('items').eq('user_id', userId).single()
    if (error) throw error
    if (activeUserId === userId && activeEpoch === epoch) { saveWatchlist(data.items); setSyncStatus('ready') }
  })().catch(error => {
    if (bootPromise === promise) bootPromise = null
    if (activeUserId === userId && activeEpoch === epoch) setSyncStatus('error')
    throw error
  })
  bootPromise = promise
  return bootPromise
}

function queueChange(symbol: string, tier: WatchTier, remove: boolean) {
  const userId = activeUserId
  if (!userId || !cloudClient) return
  pendingChanges.push({ userId, symbol, tier, remove })
  void flushChanges(userId)
}

async function flushChanges(userId: string) {
  if (processingChanges || !cloudClient || activeUserId !== userId) return
  processingChanges = true
  try {
    await initializeCloud(userId)
    while (pendingChanges.length && activeUserId === userId) {
      const change = pendingChanges[0]
      if (change.userId !== userId) { pendingChanges.shift(); continue }
      const { data, error } = await cloudClient!.rpc('apply_watchlist_change', {
        p_symbol: change.symbol, p_tier: change.tier, p_remove: change.remove,
      })
      if (error) throw error
      pendingChanges.shift()
      if (activeUserId === userId) { saveWatchlist(data); setSyncStatus('ready') }
    }
  } catch { if (activeUserId === userId) setSyncStatus('error') }
  finally { processingChanges = false }
}

async function refreshCloud(userId: string) {
  await initializeCloud(userId).catch(() => undefined)
  await flushChanges(userId)
  if (pendingChanges.some(change => change.userId === userId)) return
  const client = cloudClient
  if (activeUserId !== userId || !client) return
  const { data, error } = await client.from('user_watchlists').select('items').eq('user_id', userId).single()
  if (error) { setSyncStatus('error'); return }
  if (activeUserId === userId) { saveWatchlist(data.items); setSyncStatus('ready') }
}

export function useWatchlistCloud(userId: string | null | undefined, client: WatchlistClient | null): typeof syncStatus {
  const [status, setStatus] = useState<typeof syncStatus>('loading')
  useEffect(() => {
    const onStatus = (event: Event) => setStatus((event as CustomEvent<typeof syncStatus>).detail)
    addEventListener('protstock:watchlist-sync', onStatus)
    if (!userId || !client) { setStatus('ready'); return () => removeEventListener('protstock:watchlist-sync', onStatus) }
    activeUserId = userId
    activeEpoch += 1
    cloudClient = client
    bootPromise = null
    setSyncStatus('loading')
    void initializeCloud(userId).catch(() => undefined)
    const onFocus = () => { void refreshCloud(userId) }
    addEventListener('focus', onFocus)
    const timer = setInterval(onFocus, 30_000)
    return () => {
      removeEventListener('protstock:watchlist-sync', onStatus)
      removeEventListener('focus', onFocus)
      clearInterval(timer)
      if (activeUserId === userId) { activeEpoch += 1; activeUserId = null; cloudClient = null; bootPromise = null; pendingChanges = pendingChanges.filter(change => change.userId !== userId) }
    }
  }, [userId, client])
  return status
}

export function useWatchlist(): WatchItem[] {
  const [items, setItems] = useState(loadWatchlist)
  useEffect(() => {
    const sync = () => setItems(loadWatchlist())
    addEventListener('protstock:watchlist', sync)
    addEventListener('storage', sync)
    return () => { removeEventListener('protstock:watchlist', sync); removeEventListener('storage', sync) }
  }, [])
  return items
}

// Rejection sampling keeps every eligible symbol at exactly 1/N probability.
export function uniformIndex(length: number, nextUint32: () => number): number {
  if (!Number.isSafeInteger(length) || length < 1 || length > 0x100000000) throw new RangeError('invalid roulette pool')
  const limit = Math.floor(0x100000000 / length) * length
  let value: number
  do { value = nextUint32() >>> 0 } while (value >= limit)
  return value % length
}

export function randomWatchlistIndex(length: number): number {
  return uniformIndex(length, () => crypto.getRandomValues(new Uint32Array(1))[0])
}
