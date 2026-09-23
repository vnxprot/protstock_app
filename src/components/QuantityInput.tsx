import { useEffect, useState } from 'react'

const formatQuantity = (value: number) => Math.max(0, Math.floor(value)).toLocaleString('vi-VN')

export function QuantityInput({ value, onChange, max, disabled = false }: { value: number; onChange: (value: number) => void; max?: number; disabled?: boolean }) {
  const [draft, setDraft] = useState(value > 0 ? formatQuantity(value) : '')
  useEffect(() => setDraft(value > 0 ? formatQuantity(value) : ''), [value])
  function update(next: string) {
    const digits = next.replace(/\D/g, '')
    if (!digits) { setDraft(''); return }
    const parsed = Number(digits)
    if (!Number.isFinite(parsed)) return
    const capped = max != null ? Math.min(parsed, Math.max(0, Math.floor(max))) : parsed
    setDraft(formatQuantity(capped))
    onChange(capped)
  }
  return <input type="text" inputMode="numeric" value={draft} disabled={disabled} onChange={event => update(event.target.value)} onBlur={() => setDraft(value > 0 ? formatQuantity(value) : '')}/>
}
