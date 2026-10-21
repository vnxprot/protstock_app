import { useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDialogFocus } from '../hooks/useDialogFocus'

export type OpenAnalysisDetails = (title: string, content: ReactNode) => void
export type AnalysisDetail = { title: string; content: ReactNode }

export function AnalysisDetails({ detail, onClose }: { detail: AnalysisDetail | null; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null)
  const close = useCallback(onClose, [onClose])
  useDialogFocus(Boolean(detail), panel, close)
  if (!detail) return null
  return createPortal(<div className="quant-detail-overlay" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <section ref={panel} className="quant-detail-panel" role="dialog" aria-modal="true" aria-labelledby="quant-detail-title" tabIndex={-1}>
      <header><h2 id="quant-detail-title">{detail.title}</h2><button type="button" onClick={close} aria-label="Đóng chi tiết"><X size={18}/></button></header>
      <div className="quant-detail-content">{detail.content}</div>
    </section>
  </div>, document.body)
}
