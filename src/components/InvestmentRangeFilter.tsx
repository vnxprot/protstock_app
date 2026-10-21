import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { DateField } from './DateField'
import { formatDate } from '../lib/date'

type Props = {
  label: string
  from: string
  to: string
  onChange: (from: string, to: string) => void
  kind?: 'number' | 'date'
  suffix?: string
  min?: number
  max?: number
}

export function InvestmentRangeFilter({ label, from, to, onChange, kind = 'number', suffix = '', min, max }: Props) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const active = Boolean(from || to)
  const summary = active ? `${kind === 'date' ? formatDate(from) : from || '−∞'} – ${kind === 'date' ? formatDate(to) : to || '+∞'}${suffix}` : label
  const outsideBounds = kind === 'number' && [draftFrom, draftTo].some(value => value !== '' && (min != null && Number(value) < min || max != null && Number(value) > max))
  const invalid = outsideBounds || draftFrom !== '' && draftTo !== '' && (kind === 'date' ? draftFrom > draftTo : Number(draftFrom) > Number(draftTo))

  function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  function show() {
    const rect = trigger.current!.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - 304)), top: rect.bottom + 6 })
    setDraftFrom(from); setDraftTo(to); setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false) }
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) setOpen(false) }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keydown)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', close)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close) }
  }, [open])

  return <div className="investment-primary-field investment-range-field"><span>{label}</span><button ref={trigger} type="button" className={'investment-range-trigger' + (active ? ' active' : '')} aria-label={`Lọc ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? close() : show()}><span title={summary}>{summary}</span>{kind === 'date' ? <CalendarDays size={15}/> : <ChevronDown size={15}/>}</button>
    {open && createPortal(<div ref={panel} id={id} className="investment-range-menu" role="dialog" aria-label={`Lọc ${label}`} style={{ position: 'fixed', ...position }}>
      <strong>{label}</strong>
      {kind === 'date' ? <div className="investment-range-fields"><DateField label="Từ ngày" value={draftFrom} onChange={setDraftFrom}/><DateField label="Đến ngày" value={draftTo} onChange={setDraftTo}/></div> : <div className="investment-range-fields"><label>Từ<input type="number" step="any" min={min} max={max} value={draftFrom} placeholder="Không giới hạn" onChange={event => setDraftFrom(event.target.value)}/></label><label>Đến<input type="number" step="any" min={min} max={max} value={draftTo} placeholder="Không giới hạn" onChange={event => setDraftTo(event.target.value)}/></label></div>}
      {invalid && <small className="form-error">Giá trị Từ phải nhỏ hơn hoặc bằng Đến.</small>}
      <div className="investment-range-actions"><button type="button" onClick={() => { onChange('', ''); close() }}>Xóa lọc</button><button type="button" disabled={invalid} onClick={() => { onChange(draftFrom, draftTo); close() }}>Áp dụng</button></div>
    </div>, document.body)}
  </div>
}
