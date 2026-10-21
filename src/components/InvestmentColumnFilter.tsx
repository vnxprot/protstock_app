import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownAZ, ArrowUpAZ, Check, Filter, Search, X } from 'lucide-react'
import type { ColumnChoice } from '../lib/investmentFilters'

export function InvestmentColumnFilter({ label, options, selected, direction, numeric = false, onChange, onSort }: {
  label: string; options: ColumnChoice[]; selected?: string[]; direction?: 'asc' | 'desc'; numeric?: boolean
  onChange: (selected: string[] | undefined) => void; onSort: (direction: 'asc' | 'desc' | null) => void
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [draft, setDraft] = useState<string[]>([])
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 500 })
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null)
  const id = useId()
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd')
  const visible = options.filter(option => normalize(option.label).includes(normalize(query)))
  const allVisible = visible.length > 0 && visible.every(option => draft.includes(option.key))
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  function show() {
    const rect = trigger.current!.getBoundingClientRect(), height = Math.min(480, innerHeight - 16)
    const below = innerHeight - rect.bottom - 8
    setPosition({ left: Math.max(8, Math.min(rect.right - 288, innerWidth - 296)), top: below >= height ? rect.bottom + 6 : Math.max(8, Math.min(rect.top - height - 6, innerHeight - height - 8)), maxHeight: height })
    setQuery(''); setDraft(selected ?? options.map(option => option.key)); setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    search.current?.focus({ preventScroll: true })
    const dismiss = (event: Event) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false) }
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    window.addEventListener('scroll', scroll, true); window.addEventListener('resize', close)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close) }
  }, [open])
  return <div className="investment-column-heading"><span title={label}>{label}</span><button ref={trigger} type="button" className={selected || direction ? 'investment-funnel active' : 'investment-funnel'} aria-label={`Lọc cột ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" title={`Lọc và sắp xếp ${label}`} onClick={() => open ? close() : show()}><Filter size={13}/>{direction && <small>{direction === 'asc' ? '↑' : '↓'}</small>}</button>
    {open && createPortal(<div id={id} ref={panel} className="investment-column-menu" style={{ position: 'fixed', ...position }} role="dialog" aria-label={`Bộ lọc cột ${label}`} onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')
      if (!controls?.length) return
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus() }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus() }
    }}>
      <div className="investment-column-menu-title"><strong>{label}</strong><button type="button" aria-label="Đóng bộ lọc cột" onClick={close}><X size={15}/></button></div>
      <div className="investment-column-sort"><button type="button" onClick={() => { onSort('asc'); close() }} aria-pressed={direction === 'asc'}><ArrowDownAZ size={15}/>{numeric ? 'Tăng dần' : 'Sắp xếp A–Z'}</button><button type="button" onClick={() => { onSort('desc'); close() }} aria-pressed={direction === 'desc'}><ArrowUpAZ size={15}/>{numeric ? 'Giảm dần' : 'Sắp xếp Z–A'}</button>{direction && <button type="button" onClick={() => { onSort(null); close() }}>Bỏ sắp xếp</button>}</div>
      <label className="investment-column-search"><Search size={14}/><input ref={search} aria-label={`Tìm giá trị trong ${label}`} placeholder="Tìm trong cột…" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <label className="investment-column-option investment-select-all"><input type="checkbox" checked={allVisible} onChange={() => setDraft(previous => allVisible ? previous.filter(key => !visible.some(option => option.key === key)) : [...new Set([...previous, ...visible.map(option => option.key)])])}/><span>{query ? 'Chọn tất cả kết quả' : 'Chọn tất cả'}</span><small>{visible.length}</small></label>
      <div className="investment-column-options">{visible.map(option => <label className="investment-column-option" key={option.key} title={option.label}><input type="checkbox" checked={draft.includes(option.key)} onChange={() => setDraft(previous => previous.includes(option.key) ? previous.filter(key => key !== option.key) : [...previous, option.key])}/><span>{option.label}</span></label>)}{!visible.length && <p>Không có giá trị phù hợp.</p>}</div>
      <div className="investment-column-footer"><button type="button" onClick={() => { onChange(undefined); close() }}>Xóa lọc cột</button><button type="button" className="investment-column-apply" onClick={() => { const chosen = query ? draft.filter(key => visible.some(option => option.key === key)) : draft; onChange(chosen.length === options.length && options.every(option => chosen.includes(option.key)) ? undefined : chosen); close() }}><Check size={14}/>Áp dụng</button></div>
    </div>, document.body)}
  </div>
}
