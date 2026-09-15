import { useEffect, useMemo, useState } from 'react'

type SymbolOption = { id: number; symbol: string; sector?: string | null }

export function SymbolAutocomplete({ symbols, value, onChange, label = 'Mã cổ phiếu' }: { symbols: SymbolOption[]; value: string; onChange: (symbol: string) => void; label?: string }) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  useEffect(() => setQuery(value), [value])
  const matches = useMemo(() => {
    const normalized = query.trim().toUpperCase()
    if (!normalized) return symbols.slice(0, 6)
    return symbols.filter(item => item.symbol.includes(normalized) || item.sector?.toUpperCase().includes(normalized)).slice(0, 6)
  }, [query, symbols])
  const choose = (symbol: string) => { onChange(symbol); setQuery(symbol); setOpen(false) }
  return <label className="symbol-autocomplete">{label}
    <input value={query} placeholder="Nhập mã, ví dụ FPT" autoCapitalize="characters" autoComplete="off" onFocus={() => setOpen(true)} onChange={event => { const next = event.target.value.toUpperCase(); setQuery(next); onChange(next) }} onBlur={() => setTimeout(() => setOpen(false), 120)} />
    {open && <div className="symbol-suggestions" role="listbox">{matches.map(item => <button type="button" key={item.id} onMouseDown={event => event.preventDefault()} onClick={() => choose(item.symbol)}><strong>{item.symbol}</strong><small>{item.sector ?? 'Chưa phân ngành'}</small></button>)}{!matches.length && <span>Không tìm thấy mã phù hợp</span>}</div>}
  </label>
}
