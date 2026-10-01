import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { WatchItem } from '../lib/watchlist'

export function InvestmentReasonSheet({ item, companyName, onClose }: {
  item: WatchItem
  companyName: string | null
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const boardRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('keydown', onEscape)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [onClose])

  const keepFocusInside = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    if (event.shiftKey && document.activeElement === closeRef.current) {
      event.preventDefault()
      boardRef.current?.focus()
    } else if (!event.shiftKey && document.activeElement === boardRef.current) {
      event.preventDefault()
      closeRef.current?.focus()
    }
  }

  return <div className="watch-reason-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="watch-reason-sheet" role="dialog" aria-modal="true" aria-labelledby="watch-reason-title" onKeyDown={keepFocusInside}>
      <div className="watch-reason-handle" aria-hidden="true"/>
      <header className="watch-reason-header"><div><span>Tier {item.tier} · {item.symbol}</span><h2 id="watch-reason-title">Lý do đầu tư</h2></div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng Lý do đầu tư"><X size={20}/></button></header>
      {companyName && <p className="watch-reason-company">{companyName}</p>}
      <div className="watch-reason-content">{item.reason.trim() || <span>Chưa có lý do đầu tư cho mã này.</span>}</div>
      <a ref={boardRef} className="watch-reason-edit" href="#watchlist-board" onClick={onClose}>Mở bảng để chỉnh sửa</a>
    </section>
  </div>
}
