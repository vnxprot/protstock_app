import { supabase } from './supabase'

type Payload = { evidence: unknown }
const cache = new Map<string, Promise<Record<string, Payload>>>()

function loadArchive(path: string) {
  const existing = cache.get(path)
  if (existing) return existing
  const request = (async () => {
    const checksum = /^analysis\/v1\/[a-z_]+\/\d{4}-\d{2}-\d{2}\/([0-9a-f]{64})\.json\.gz$/.exec(path)?.[1]
    if (!supabase || !checksum) throw new Error('Đường dẫn lịch sử phân tích không hợp lệ.')
    const { data, error } = await supabase.storage.from('database-archives').download(path)
    if (error) throw error
    const sha = await crypto.subtle.digest('SHA-256', await data.arrayBuffer())
    const actual = Array.from(new Uint8Array(sha), byte => byte.toString(16).padStart(2, '0')).join('')
    if (actual !== checksum) throw new Error('Tệp lịch sử phân tích không khớp mã kiểm tra.')
    const stream = data.stream().pipeThrough(new DecompressionStream('gzip'))
    return await new Response(stream).json() as Record<string, Payload>
  })()
  cache.set(path, request)
  if (cache.size > 12) cache.delete(cache.keys().next().value!)
  void request.catch(() => { if (cache.get(path) === request) cache.delete(path) })
  return request
}

export function restoreAnalysisHistory<T extends { evidence?: unknown }>(rows: readonly T[]): Promise<T[]> {
  return Promise.all(rows.map(async row => {
    const marker = row.evidence as { _historyObject?: string; _historyKey?: string } | null | undefined
    if (!marker?._historyObject || !marker._historyKey) return row
    const archive = await loadArchive(marker._historyObject)
    const payload = archive[marker._historyKey]
    if (!payload) throw new Error('Tệp lịch sử thiếu bản ghi phân tích.')
    return { ...row, evidence: payload.evidence }
  }))
}
