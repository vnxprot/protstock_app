export type StoredJournalNote = { id: string; user_id?: string }
const prefix = (owner: string) => 'protstock-journal-outbox:' + owner
const flushing = new Set<string>()

export function readJournalOutbox<T extends StoredJournalNote>(owner: string): T[] {
  const notes = new Map<string, T>()
  const keep = (item: T) => { if (item && typeof item.id === 'string' && item.user_id === owner) notes.set(item.id, item) }
  try {
    try { const legacy = JSON.parse(localStorage.getItem(prefix(owner)) ?? '[]'); if (Array.isArray(legacy)) legacy.forEach(keep) } catch { /* Read distinct note keys even if a legacy entry is damaged. */ }
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix(owner) + ':note:')) try { keep(JSON.parse(localStorage.getItem(key) ?? 'null')) } catch { /* Other notes remain recoverable. */ }
    }
  } catch { /* A blocked local store is reported by the save operation. */ }
  return [...notes.values()]
}

export function queueJournalNote<T extends StoredJournalNote>(owner: string, note: T) {
  if (note.user_id !== owner) throw new Error('Journal note owner mismatch')
  localStorage.setItem(prefix(owner) + ':note:' + note.id, JSON.stringify(note))
}

export function acknowledgeJournalNote(owner: string, id: string) {
  localStorage.removeItem(prefix(owner) + ':note:' + id)
  const legacy = localStorage.getItem(prefix(owner))
  if (legacy) try { localStorage.setItem(prefix(owner), JSON.stringify(JSON.parse(legacy).filter((note: StoredJournalNote) => note.id !== id))) } catch { /* Durable note keys are independent of this legacy array. */ }
}

export async function syncJournalOutbox<T extends StoredJournalNote>(owner: string, insert: (note: T) => PromiseLike<{ error: { code?: string } | null }>) {
  const run = async () => {
    if (flushing.has(owner)) return
    flushing.add(owner)
    try {
      for (;;) {
        const note = readJournalOutbox<T>(owner)[0]
        if (!note) break
        const { error } = await insert(note)
        if (error && error.code !== '23505') throw error
        acknowledgeJournalNote(owner, note.id)
      }
    } finally { flushing.delete(owner) }
  }
  if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('protstock-journal:' + owner, { ifAvailable: true }, async lock => { if (lock) await run() })
  else await run()
}

export function clearSavedJournalDrafts(owner: string, noteId: string) {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('protstock-journal-draft:' + owner + ':')) try {
      if (JSON.parse(localStorage.getItem(key) ?? 'null')?.id === noteId) localStorage.removeItem(key)
    } catch { /* Do not erase an unrelated draft. */ }
  }
}
