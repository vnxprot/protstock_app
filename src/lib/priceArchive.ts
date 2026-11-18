import { supabase } from './supabase'

type ArchivedPrice = {
  trading_date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  source: string
  data_revision?: string
  quality_status: string
  price_basis?: string
  volume_basis?: string
  volume_adjustment_factor?: number
}

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('protstock-cold-prices', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('prices')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Price cache is blocked'))
  })
}

async function cachedBlob(symbolId: number, checksum: string, blob?: Blob): Promise<Blob | undefined> {
  if (!globalThis.indexedDB) return undefined
  const db = await openCache()
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const transaction = db.transaction('prices', blob ? 'readwrite' : 'readonly')
      const store = transaction.objectStore('prices')
      const request = blob ? store.put({ checksum, blob }, symbolId) : store.get(symbolId)
      transaction.oncomplete = () => resolve(!blob && request.result?.checksum === checksum ? request.result.blob : undefined)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

async function decode(blob: Blob, checksum: string): Promise<ArchivedPrice[]> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  if (Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') !== checksum) {
    throw new Error('Bản lưu giá có mã kiểm tra không khớp')
  }
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json()
}

export async function loadArchivedPrices(symbolId: number, through?: string, retry = true) {
  if (!supabase) return []
  const { data, error } = await supabase.from('daily_price_archives')
    .select('first_day,checksum').eq('symbol_id', symbolId).maybeSingle()
  if (error?.code === 'PGRST205' || error?.code === '42P01') return []
  if (error) throw error
  if (!data || (through && data.first_day > through)) return []
  let blob = await cachedBlob(symbolId, data.checksum).catch(() => undefined)
  if (blob) {
    try {
      return (await decode(blob, data.checksum)).filter(row => !through || row.trading_date <= through)
    } catch {
      blob = undefined
    }
  }
  const downloaded = await supabase.storage.from('database-archives')
    .download(`ohlcv/vci/${symbolId}/${data.checksum}.json.gz`)
  if (downloaded.error && retry) return loadArchivedPrices(symbolId, through, false)
  if (downloaded.error) throw downloaded.error
  const rows = await decode(downloaded.data, data.checksum)
  void cachedBlob(symbolId, data.checksum, downloaded.data).catch(() => undefined)
  return rows.filter(row => !through || row.trading_date <= through)
}
