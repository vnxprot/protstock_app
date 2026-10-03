import { useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import type { WatchItem } from '../lib/watchlist'
import { useDialogFocus } from '../hooks/useDialogFocus'

const details: { key: 'reason' | 'buyZone' | 'targetPrice' | 'stopLoss'; label: string }[] = [
  { key: 'reason', label: 'Lý do đầu tư' },
  { key: 'buyZone', label: 'Điểm mua' },
  { key: 'targetPrice', label: 'Mục tiêu' },
  { key: 'stopLoss', label: 'Cắt lỗ' },
]

export function InvestmentReasonSheet({ item, companyName, onClose }: {
  item: WatchItem
  companyName: string | null
  onClose: () => void
}) {
  const sheetRef = useRef<HTMLElement>(null)
  const close = useCallback(onClose, [onClose])
  useDialogFocus(true, sheetRef, close)

  return <div className="watch-reason-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={sheetRef} tabIndex={-1} className="watch-reason-sheet" role="dialog" aria-modal="true" aria-labelledby="watch-reason-title" onMouseDown={event => event.stopPropagation()}>
      <div className="watch-reason-handle" aria-hidden="true"/>
      <header className="watch-reason-header"><div><span>Tier {item.tier} · {item.symbol}</span><h2 id="watch-reason-title">Thông tin theo dõi</h2></div>
        <button type="button" onClick={onClose} aria-label="Đóng thông tin theo dõi"><X size={20}/></button></header>
      {companyName && <p className="watch-reason-company">{companyName}</p>}
      <div className="watch-reason-fields">{details.map(({ key, label }) => <section key={key}>
        <h3>{label}</h3><p>{item[key].trim() || <span>Chưa ghi {label.toLocaleLowerCase('vi')}.</span>}</p>
      </section>)}</div>
      <a className="watch-reason-edit" href="#watchlist-board" onClick={onClose}>Mở bảng để chỉnh sửa</a>
    </section>
  </div>
}
