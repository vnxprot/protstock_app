import { useEffect, useState } from 'react'
import { formatVnd } from '../lib/marketUnits'

function parseVietnameseNumber(value: string) {
  const normalized = value.trim().replaceAll('.', '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function CurrencyInput({ value, onChange, placeholder = '0', label }: { value: number; onChange: (value: number) => void; placeholder?: string; label?: string }) {
  const [draft, setDraft] = useState(value ? formatVnd(value).replace(' ₫', '') : '')
  useEffect(() => setDraft(value ? formatVnd(value).replace(' ₫', '') : ''), [value])
  return <label className="currency-input">{label}
    <span><input type="text" inputMode="decimal" value={draft} placeholder={placeholder} onChange={event => { const next = event.target.value; setDraft(next); const parsed = parseVietnameseNumber(next); if (parsed != null) onChange(parsed) }} onBlur={() => setDraft(value ? formatVnd(value).replace(' ₫', '') : '')}/><i>₫</i></span>
  </label>
}
