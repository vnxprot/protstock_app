import { useEffect, useState } from 'react'

export type WatchTier = 'B' | 'A' | 'S'
export type WatchItem = { symbol: string; tier: WatchTier; addedAt: string }
const WATCHLIST_KEY = 'protstock-watchlist-v1'
const LEGACY_KEY = 'protstock-favorites'
const validTier = (value: unknown): value is WatchTier => value === 'B' || value === 'A' || value === 'S'
const validSymbol = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9]{2,8}$/.test(value)

export function normalizeWatchlist(value: unknown): WatchItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(item => {
    const symbol = typeof item === 'string' ? item : item?.symbol
    if (!validSymbol(symbol) || seen.has(symbol)) return []
    seen.add(symbol)
    return [{ symbol, tier: validTier(item?.tier) ? item.tier : 'B', addedAt: typeof item?.addedAt === 'string' ? item.addedAt : '' }]
  })
}

export function loadWatchlist(): WatchItem[] {
  try {
    const stored = localStorage.getItem(WATCHLIST_KEY)
    if (stored !== null) return normalizeWatchlist(JSON.parse(stored))
    const migrated = normalizeWatchlist(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]'))
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(migrated))
    return migrated
  } catch { return [] }
}

export function saveWatchlist(value: WatchItem[]): WatchItem[] {
  const items = normalizeWatchlist(value)
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items))
  const symbols = items.map(item => item.symbol)
  localStorage.setItem(LEGACY_KEY, JSON.stringify(symbols))
  dispatchEvent(new CustomEvent('protstock:watchlist', { detail: items }))
  dispatchEvent(new CustomEvent('protstock:favorites', { detail: symbols }))
  return items
}

export function toggleWatchlistSymbol(symbol: string): WatchItem[] {
  const items = loadWatchlist()
  return saveWatchlist(items.some(item => item.symbol === symbol)
    ? items.filter(item => item.symbol !== symbol)
    : [{ symbol, tier: 'B', addedAt: new Date().toISOString() }, ...items])
}

export function setWatchlistTier(symbol: string, tier: WatchTier): WatchItem[] {
  return saveWatchlist(loadWatchlist().map(item => item.symbol === symbol ? { ...item, tier } : item))
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
