import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { formatDate } from '../lib/date'

export function DateField({value, onChange, label}: {value: string; onChange: (value: string) => void; label: string}) {
  const [text, setText] = useState(value ? formatDate(value) : '')
  const [invalid, setInvalid] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.setCustomValidity(invalid ? 'Ngày không hợp lệ (dd/mm/yyyy)' : '') }, [invalid])
  useEffect(() => { setText(value ? formatDate(value) : ''); setInvalid(false) }, [value])
  function update(next: string) {
    setText(next)
    if (!next) { setInvalid(false); onChange(''); return }
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next)
    if (!match) { setInvalid(true); return }
    const iso = `${match[3]}-${match[2]}-${match[1]}`
    const date = new Date(`${iso}T00:00:00Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==iso) { setInvalid(true); return }
    setInvalid(false); onChange(iso)
  }
  return <label className="date-field"><span>{label}</span><span className="date-input-wrap"><input ref={input} type="text" inputMode="numeric" placeholder="dd/mm/yyyy" aria-label={label} aria-invalid={invalid} value={text} maxLength={10} onChange={event=>update(event.target.value)} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"/><span className="date-calendar"><CalendarDays size={17}/><input type="date" aria-label={`Lịch ${label.toLowerCase()}`} value={value} onChange={event=>{setInvalid(false);setText(event.target.value ? formatDate(event.target.value) : '');onChange(event.target.value)}}/></span></span>{invalid && <small className="negative">Nhập ngày hợp lệ: dd/mm/yyyy</small>}</label>
}
