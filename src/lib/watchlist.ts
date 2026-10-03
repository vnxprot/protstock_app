import { useEffect, useState } from 'react'

type WatchlistClient = NonNullable<typeof import('./supabase').supabase>
export type WatchTier = 'B' | 'A' | 'S'
export type WatchStatus = 'On' | 'Off'
export type WatchItem = { symbol: string; tier: WatchTier; addedAt: string; status: WatchStatus; reason: string; investmentHorizon: string; buyZone: string; targetPrice: string; stopLoss: string }
export type WatchPatch = Partial<Pick<WatchItem, 'tier' | 'status' | 'reason' | 'investmentHorizon' | 'buyZone' | 'targetPrice' | 'stopLoss'>>
export type WatchChange = { id: string; symbol: string; patch?: WatchPatch; tier?: WatchTier; remove?: boolean; addedAt: string; queuedAt?: number }
export const WATCHLIST_REASON_LIMIT = 4000
export const WATCHLIST_DETAIL_LIMIT = 1000
const WATCHLIST_KEY = 'protstock-watchlist-v1'
const OUTBOX_KEY = 'protstock-watchlist-outbox-v1'
const LEGACY_KEY = 'protstock-favorites'
const LEGACY_OWNER_KEY = 'protstock-watchlist-legacy-owner'
const RETIRED_SYMBOLS = new Set(['DHM', 'LTG', 'DMC', 'POS', 'MTA', 'AMC', 'DHD', 'DPC', 'PXS', 'SP2', 'TAR', 'TCD'])
let activeUserId: string | null = null
let cloudClient: WatchlistClient | null = null
let activeEpoch = 0
let bootPromise: Promise<void> | null = null
let operationClock = 0
let syncStatus: 'loading' | 'ready' | 'error' = 'loading'
const flushing = new Set<string>()
const validTier = (value: unknown): value is WatchTier => value === 'B' || value === 'A' || value === 'S'
const validSymbol = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9]{2,8}$/.test(value)
const textField = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : ''
export const isWatchActive = (item: WatchItem) => item.status !== 'Off'
function cleanPatch(value: WatchPatch): WatchPatch {
  const patch: WatchPatch = {}
  if (validTier(value.tier)) patch.tier = value.tier
  if (value.status === 'On' || value.status === 'Off') patch.status = value.status
  for (const key of ['reason', 'investmentHorizon', 'buyZone', 'targetPrice', 'stopLoss'] as const) if (typeof value[key] === 'string') patch[key] = textField(value[key], key === 'reason' ? WATCHLIST_REASON_LIMIT : WATCHLIST_DETAIL_LIMIT)
  return patch
}
function changePatch(change: WatchChange): WatchPatch {
  return change.patch ? cleanPatch(change.patch) : validTier(change.tier) && typeof change.remove === 'boolean' ? { tier: change.tier, status: change.remove ? 'Off' : 'On' } : {}
}
const accountKey = () => activeUserId ? `${WATCHLIST_KEY}:${activeUserId}` : WATCHLIST_KEY
const emit = () => dispatchEvent(new CustomEvent('protstock:watchlist-sync', { detail: syncStatus }))
function setSyncStatus(status: typeof syncStatus) { syncStatus = status; emit() }

export function normalizeWatchlist(value: unknown): WatchItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(item => {
    const symbol = typeof item === 'string' ? item : item?.symbol
    if (!validSymbol(symbol) || RETIRED_SYMBOLS.has(symbol) || seen.has(symbol)) return []
    seen.add(symbol)
    return [{ symbol, tier: validTier(item?.tier) ? item.tier : 'B', addedAt: typeof item?.addedAt === 'string' ? item.addedAt : '', status: item?.status === 'Off' ? 'Off' : 'On', reason: textField(item?.reason, WATCHLIST_REASON_LIMIT), investmentHorizon: textField(item?.investmentHorizon, WATCHLIST_DETAIL_LIMIT), buyZone: textField(item?.buyZone, WATCHLIST_DETAIL_LIMIT), targetPrice: textField(item?.targetPrice, WATCHLIST_DETAIL_LIMIT), stopLoss: textField(item?.stopLoss, WATCHLIST_DETAIL_LIMIT) }]
  })
}

export function readWatchlistOutbox(userId: string): WatchChange[] {
  try {
    let values: WatchChange[] = []
    try { const legacy = JSON.parse(localStorage.getItem(OUTBOX_KEY+':'+userId) ?? '[]'); if (Array.isArray(legacy)) values = legacy } catch { /* A damaged legacy entry must not hide distinct durable operations. */ }
    const prefix = OUTBOX_KEY+':'+userId+':operation:'
    for (let index=0; index<localStorage.length; index+=1) {
      const key=localStorage.key(index)
      if (key?.startsWith(prefix)) try { const operation=JSON.parse(localStorage.getItem(key)??'null'); if(operation)values.push(operation) } catch { /* Keep reading the other operations. */ }
    }
    const seen=new Set<string>()
    return values.filter(item => typeof item?.id === 'string' && validSymbol(item.symbol) && Object.keys(changePatch(item)).length > 0 && !seen.has(item.id) && Boolean(seen.add(item.id))).sort((a,b)=>(a.queuedAt??0)-(b.queuedAt??0)||a.id.localeCompare(b.id))
  } catch { return [] }
}
// Legacy-array writing is kept for migration; live appends use a distinct key per operation.
export function writeWatchlistOutbox(userId: string, changes: WatchChange[]) {
  localStorage.setItem(OUTBOX_KEY+':'+userId, JSON.stringify(changes))
}
function appendWatchlistOperation(userId: string, change: WatchChange) {
  localStorage.setItem(OUTBOX_KEY+':'+userId+':operation:'+change.id,JSON.stringify(change))
}
function acknowledgeWatchlistOperation(userId: string, id: string) {
  localStorage.removeItem(OUTBOX_KEY+':'+userId+':operation:'+id)
  const legacy=localStorage.getItem(OUTBOX_KEY+':'+userId)
  if(legacy)try{writeWatchlistOutbox(userId,JSON.parse(legacy).filter((item:WatchChange)=>item.id!==id))}catch{/* Individual durable operations remain readable. */}
}
export function overlayWatchlist(items: WatchItem[], changes: WatchChange[]): WatchItem[] {
  let next = normalizeWatchlist(items)
  for (const change of changes) {
    const patch = changePatch(change)
    const existing = next.find(item => item.symbol === change.symbol)
    next = existing ? next.map(item => item.symbol === change.symbol ? { ...item, ...patch } : item)
      : [...normalizeWatchlist([{ symbol: change.symbol, tier: 'B', status: 'On', addedAt: change.addedAt, ...patch }]), ...next]
  }
  return next
}
export function pendingWatchlistCount(): number { return activeUserId ? readWatchlistOutbox(activeUserId).length : 0 }

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
  const symbols = items.filter(isWatchActive).map(item => item.symbol)
  // Legacy export remains for unauthenticated migration; account data never replaces it.
  if (!activeUserId) localStorage.setItem(LEGACY_KEY, JSON.stringify(symbols))
  dispatchEvent(new CustomEvent('protstock:watchlist', { detail: items }))
  dispatchEvent(new CustomEvent('protstock:favorites', { detail: symbols }))
  return items
}
function queueChange(symbol: string, patch: WatchPatch, addedAt: string) {
  if (!activeUserId) return
  // Each operation has a separate key so two tabs cannot overwrite each other's append.
  operationClock = Math.max(Date.now(), operationClock + 0.001, ...readWatchlistOutbox(activeUserId).map(item => (item.queuedAt ?? 0) + 0.001))
  appendWatchlistOperation(activeUserId, { id: crypto.randomUUID(), symbol, patch: cleanPatch(patch), addedAt, queuedAt: operationClock })
  emit()
}
export function toggleWatchlistSymbol(symbol: string): WatchItem[] {
  const items = loadWatchlist(), existing = items.find(item => item.symbol === symbol)
  const status: WatchStatus = existing && isWatchActive(existing) ? 'Off' : 'On'
  const addedAt = existing?.addedAt ?? new Date().toISOString()
  const patch: WatchPatch = { status, tier: existing?.tier ?? 'B' }
  queueChange(symbol, patch, addedAt)
  const next = saveWatchlist(overlayWatchlist(items, [{ id: 'local', symbol, patch, addedAt }]))
  if (activeUserId) void flushChanges(activeUserId)
  return next
}
export function setWatchlistTier(symbol: string, tier: WatchTier): WatchItem[] {
  return updateWatchlistItem(symbol, { tier, status: 'On' })
}
export function updateWatchlistItem(symbol: string, value: WatchPatch): WatchItem[] {
  const items = loadWatchlist(), existing = items.find(item => item.symbol === symbol)
  if (!existing) return items
  const patch = cleanPatch(value)
  if (!Object.keys(patch).length) return items
  queueChange(symbol, patch, existing.addedAt)
  const next = saveWatchlist(overlayWatchlist(items, [{ id: 'local', symbol, patch, addedAt: existing.addedAt }]))
  if (activeUserId) void flushChanges(activeUserId)
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
      const { error } = await client.from('user_watchlists').insert({ user_id: userId, items: localItems, legacy_imported: true })
      if (error && error.code !== '23505') throw error
    }
    const { data, error } = await client.from('user_watchlists').select('items').eq('user_id', userId).single()
    if (error) throw error
    if (activeUserId === userId && activeEpoch === epoch) {
      saveWatchlist(overlayWatchlist(data.items, readWatchlistOutbox(userId)))
      setSyncStatus('ready')
    }
  })().catch(error => {
    if (bootPromise === promise) bootPromise = null
    if (activeUserId === userId && activeEpoch === epoch) setSyncStatus('error')
    throw error
  })
  bootPromise = promise
  return promise
}
async function flushChanges(userId: string) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request('protstock-watchlist:'+userId,{ifAvailable:true},async lock=>{ if(lock)await flushChangesLocked(userId) })
  } else await flushChangesLocked(userId)
}
async function flushChangesLocked(userId: string) {
  if (flushing.has(userId) || !cloudClient || activeUserId !== userId) return
  const client = cloudClient
  const epoch = activeEpoch
  flushing.add(userId)
  try {
    await initializeCloud(userId)
    while (activeUserId === userId && activeEpoch === epoch) {
      const change = readWatchlistOutbox(userId)[0]
      if (!change) break
      const { data, error } = await client.rpc('apply_watchlist_entry', { p_symbol: change.symbol, p_patch: changePatch(change), p_expected_user_id: userId })
      if (error) throw error
      // Remove only this acknowledged operation; another tab may have appended new intent.
      acknowledgeWatchlistOperation(userId,change.id)
      const remaining = readWatchlistOutbox(userId)
      if (activeUserId === userId && activeEpoch === epoch) { saveWatchlist(overlayWatchlist(data, remaining)); setSyncStatus('ready') }
    }
  } catch { if (activeUserId === userId && activeEpoch === epoch) setSyncStatus('error') }
  finally { flushing.delete(userId) }
}
async function refreshCloud(userId: string) {
  const epoch = activeEpoch
  await flushChanges(userId)
  if (pendingWatchlistCount() || activeUserId !== userId || activeEpoch !== epoch || !cloudClient) return
  const { data, error } = await cloudClient.from('user_watchlists').select('items').eq('user_id', userId).single()
  if (error) { setSyncStatus('error'); return }
  if (activeUserId === userId && activeEpoch === epoch) { saveWatchlist(overlayWatchlist(data.items, readWatchlistOutbox(userId))); setSyncStatus('ready') }
}
export function retryWatchlistSync() { if (activeUserId) void refreshCloud(activeUserId) }

export async function startWatchlistSync(userId: string, client: WatchlistClient) {
  activeUserId = userId; activeEpoch += 1; cloudClient = client; bootPromise = null
  setSyncStatus('loading'); saveWatchlist(loadWatchlist())
  await initializeCloud(userId)
  await flushChanges(userId)
}
export function stopWatchlistSync(userId: string) {
  if (activeUserId === userId) { activeEpoch += 1; activeUserId = null; cloudClient = null; bootPromise = null }
}

export function useWatchlistCloud(userId: string | null | undefined, client: WatchlistClient | null): typeof syncStatus {
  const [status, setStatus] = useState<typeof syncStatus>('loading')
  useEffect(() => {
    const onStatus = (event: Event) => setStatus((event as CustomEvent<typeof syncStatus>).detail)
    addEventListener('protstock:watchlist-sync', onStatus)
    if (!userId || !client) { setStatus('ready'); return () => removeEventListener('protstock:watchlist-sync', onStatus) }
    // Show this account's local list immediately; cloud hydration overlays persisted intent.
    void startWatchlistSync(userId, client).catch(() => undefined)
    const refresh = () => { if (document.visibilityState !== 'hidden') void refreshCloud(userId) }
    const storage = (event: StorageEvent) => { if (event.key?.startsWith(OUTBOX_KEY+':'+userId)) refresh() }
    addEventListener('focus', refresh); addEventListener('online', refresh); addEventListener('storage', storage)
    const timer = setInterval(refresh, 60_000)
    return () => {
      removeEventListener('protstock:watchlist-sync', onStatus); removeEventListener('focus', refresh); removeEventListener('online', refresh); removeEventListener('storage', storage); clearInterval(timer)
      stopWatchlistSync(userId)
    }
  }, [userId, client])
  return status
}
export function useWatchlistPendingCount() {
  const [count, setCount] = useState(pendingWatchlistCount)
  useEffect(() => { const refresh = () => setCount(pendingWatchlistCount()); addEventListener('protstock:watchlist-sync', refresh); addEventListener('storage', refresh); return () => { removeEventListener('protstock:watchlist-sync', refresh); removeEventListener('storage', refresh) } }, [])
  return count
}
export function useWatchlist(): WatchItem[] {
  const [items, setItems] = useState(loadWatchlist)
  useEffect(() => { const sync = () => setItems(loadWatchlist()); addEventListener('protstock:watchlist', sync); addEventListener('storage', sync); return () => { removeEventListener('protstock:watchlist', sync); removeEventListener('storage', sync) } }, [])
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
export function randomWatchlistIndex(length: number): number { return uniformIndex(length, () => crypto.getRandomValues(new Uint32Array(1))[0]) }
