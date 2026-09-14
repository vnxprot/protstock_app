import { Children, isValidElement, useEffect, useId, useRef, useState, type SelectHTMLAttributes, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

// Keep a native select for React form contracts; desktop popup is app-styled.
export function SoftSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const select = useRef<HTMLSelectElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState({left: 0, top: 0, width: 240, maxHeight: 280})
  const options: {value: string; label: string; disabled: boolean}[] = []
  function collect(children: React.ReactNode) {
    Children.forEach(children, child => {
      if (!isValidElement(child)) return
      const node = child as ReactElement<any>
      if (node.type === 'option') options.push({value: String(node.props.value ?? node.props.children), label: Children.toArray(node.props.children).join(''), disabled: Boolean(node.props.disabled)})
      else if (node.props.children) collect(node.props.children)
    })
  }
  collect(props.children)
  const selected = options.findIndex(option => option.value === String(props.value ?? props.defaultValue ?? options[0]?.value))
  function show() {
    if (props.disabled) return
    const bounds = button.current!.getBoundingClientRect()
    const below = innerHeight - bounds.bottom - 12
    const height = Math.min(280, Math.max(below, bounds.top - 12))
    setRect({left: Math.max(8, Math.min(bounds.left, innerWidth - Math.max(bounds.width, 220) - 8)), top: below >= 180 ? bounds.bottom + 6 : Math.max(8, bounds.top - height - 6), width: Math.min(Math.max(bounds.width, 220), innerWidth - 16), maxHeight: height})
    setActive(Math.max(0, selected)); setOpen(true)
  }
  function choose(index: number) {
    if (!options[index] || options[index].disabled) return
    if (select.current) { select.current.value = options[index].value; select.current.dispatchEvent(new Event('change', {bubbles: true})) }
    setOpen(false); button.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => { if (!button.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false) }
    const resize = () => setOpen(false)
    document.addEventListener('pointerdown', close); window.addEventListener('resize', resize)
    window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', resize); window.removeEventListener('scroll', close, true) }
  }, [open])
  useEffect(() => { if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({block:'nearest'}) }, [open, active, id])
  return <span className={`soft-select ${props.className ?? ''}`}>
    <select {...props} ref={select} className="soft-select-native" tabIndex={-1} aria-hidden="true"/>
    <button ref={button} type="button" className="soft-select-trigger" disabled={props.disabled} role="combobox" aria-label={props['aria-label'] ?? options[selected]?.label} aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={() => open ? setOpen(false) : show()} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); return }
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault(); if (!open) { show(); return }
        setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open ? choose(active) : show() }
      else if (event.key.length === 1) { const found = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase())); if (found >= 0) { if (!open) show(); setActive(found) } }
    }}><span>{options[selected]?.label ?? options[0]?.label ?? 'Chọn…'}</span><ChevronDown size={14}/></button>
    {open && createPortal(<div ref={popup} id={id} role="listbox" className="soft-select-menu" style={{position:'fixed', ...rect}}>{options.map((option,index) => <div key={`${option.value}-${index}`} id={`${id}-${index}`} role="option" aria-selected={selected===index} aria-disabled={option.disabled} className={`${active===index?'highlighted':''} ${selected===index?'selected':''}`} onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>{option.label}</div>)}</div>,document.body)}
  </span>
}
