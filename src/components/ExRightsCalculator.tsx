import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Calculator, Info, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { SymbolAutocomplete } from './SymbolAutocomplete'
import { DateField } from './DateField'
import { SoftSelect } from './SoftSelect'
import { calculateExRights } from '../lib/exRights'
import { formatDate } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'
import './ex-rights-calculator.css'

type SymbolOption = { id: number; symbol: string; sector?: string | null; exchange?: string | null }
const readNumber = (value: string) => value.trim() === '' ? 0 : Number(value)

export function ExRightsCalculator({ symbols, selected }: { symbols: SymbolOption[]; selected: string | null }) {
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState(selected ?? '')
  const [exDate, setExDate] = useState('')
  const [cash, setCash] = useState('')
  const [cashMode, setCashMode] = useState<'percent' | 'vnd'>('percent')
  const [stock, setStock] = useState('')
  const [rights, setRights] = useState('')
  const [rightsPrice, setRightsPrice] = useState('')
  const [split, setSplit] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [useManualPrice, setUseManualPrice] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)
  const closeDialog = useCallback(() => setOpen(false), [])
  useDialogFocus(open, dialogRef, closeDialog)
  useEffect(() => { if (!open) setSymbol(selected ?? '') }, [selected, open])

  const chosen = symbols.find(item => item.symbol === symbol)
  const priceQuery = useQuery({
    queryKey: ['ex-rights-price', chosen?.id, exDate],
    enabled: open && Boolean(chosen) && Boolean(supabase),
    queryFn: async () => {
      let query = supabase!.from('daily_prices')
        .select('trading_date,close,source,price_unit,quality_status')
        .eq('symbol_id', chosen!.id).eq('quality_status', 'VALID')
        .order('trading_date', { ascending: false }).limit(1)
      if (exDate) query = query.lt('trading_date', exDate)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data
    },
  })
  const priceUnitValid = priceQuery.data?.price_unit === 'THOUSAND_VND_PER_SHARE'
  const eodPrice = priceUnitValid ? Number(priceQuery.data?.close) * 1000 : null
  const price = useManualPrice ? readNumber(manualPrice) : eodPrice
  const cashValue = cashMode === 'percent' ? readNumber(cash) * 100 : readNumber(cash)
  const stockRate = readNumber(stock) / 100
  const rightsRate = readNumber(rights) / 100
  const splitRate = split.trim() ? readNumber(split) : 1
  const rawValuesValid = [cash, stock, rights, rightsPrice, split, manualPrice].every(value => value.trim() === '' || Number.isFinite(Number(value)))
  const hasRight = cashValue > 0 || stockRate > 0 || rightsRate > 0 || splitRate !== 1
  const result = price != null && rawValuesValid && hasRight
    ? calculateExRights({ price, cash: cashValue, stockRate, rightsRate, rightsPrice: readNumber(rightsPrice), splitRate }) : null
  const rightsException = price != null && rightsRate > 0 && readNumber(rightsPrice) >= (price - cashValue) / (1 + stockRate)
  const stale = exDate && priceQuery.data?.trading_date && new Date(`${exDate}T00:00:00Z`).getTime() - new Date(`${priceQuery.data.trading_date}T00:00:00Z`).getTime() > 7 * 86400000
  const historicEvent = Boolean(exDate && exDate <= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }))

  const changeCashMode = (next: 'percent' | 'vnd') => {
    if (cash.trim() && Number.isFinite(Number(cash))) setCash(String(next === 'vnd' ? Number(cash) * 100 : Number(cash) / 100))
    setCashMode(next)
  }

  return <>
    <button type="button" className="ex-rights-open" onClick={() => setOpen(true)}><Calculator size={17}/> Giá sau chia</button>
    {open && createPortal(<div className="sheet-backdrop ex-rights-backdrop" onMouseDown={closeDialog}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ex-rights-title" className="bottom-sheet ex-rights-dialog" onMouseDown={event => event.stopPropagation()}>
        <div className="sheet-handle"/>
        <header className="ex-rights-header"><div><span>CÔNG CỤ ƯỚC TÍNH</span><h2 id="ex-rights-title">Giá sau chia</h2><p>Ước tính giá khi một hoặc nhiều quyền có cùng ngày không hưởng.</p></div><button type="button" className="icon-button" aria-label="Đóng công cụ" onClick={closeDialog}><X size={20}/></button></header>
        <div className="ex-rights-body">
          <div className="ex-rights-primary">
            <SymbolAutocomplete symbols={symbols} value={symbol} onChange={setSymbol}/>
            <DateField label="Ngày không hưởng quyền (nếu biết)" value={exDate} onChange={setExDate}/>
            <div className="ex-rights-price"><div><small>GIÁ TRƯỚC QUYỀN</small><strong>{priceQuery.isLoading && !useManualPrice ? 'Đang tải…' : price == null ? '—' : formatVnd(price, 0)}</strong><span>{useManualPrice ? 'Giá do bạn nhập' : priceQuery.data?.trading_date ? `EOD ${formatDate(priceQuery.data.trading_date)} · ${priceQuery.data.source}` : 'Chưa có EOD phù hợp'}{chosen?.exchange ? ` · ${chosen.exchange}` : ''}</span></div><button type="button" onClick={() => { if (!useManualPrice && eodPrice != null) setManualPrice(String(eodPrice)); setUseManualPrice(value => !value) }}>{useManualPrice ? 'Dùng EOD' : 'Sửa giá'}</button></div>
          </div>
          {useManualPrice && <label className="ex-rights-field ex-rights-manual">Giá trước quyền (đồng/CP)<input type="number" inputMode="decimal" min="0" step="any" value={manualPrice} onChange={event => setManualPrice(event.target.value)} placeholder="Ví dụ: 30000"/></label>}
          {!useManualPrice && priceQuery.isError && <p className="ex-rights-alert">Không tải được EOD. Thử lại hoặc nhập giá thủ công.</p>}
          {!useManualPrice && priceQuery.data && !priceUnitValid && <p className="ex-rights-alert">EOD này chưa xác minh đơn vị giá. Hãy nhập giá thủ công sau khi đối chiếu.</p>}
          {stale && !useManualPrice && <p className="ex-rights-alert">EOD cách ngày không hưởng quyền hơn 7 ngày. Hãy kiểm tra mã có bị thiếu phiên giao dịch không.</p>}
          {historicEvent && <p className="ex-rights-alert">Sự kiện đã qua: nguồn giá lịch sử có thể đã được điều chỉnh theo quyền. Hãy đối chiếu giá đóng cửa gốc trước quyền để tránh tính hai lần.</p>}
          <div className="ex-rights-section-title"><h3>Quyền nhận và quyền mua</h3><small>Bỏ trống mục không áp dụng</small></div>
          <div className="ex-rights-fields">
            <div className="ex-rights-field"><label htmlFor="ex-rights-cash">Cổ tức tiền mặt</label><div className="ex-rights-input-row"><input id="ex-rights-cash" type="number" inputMode="decimal" min="0" step="any" value={cash} onChange={event => setCash(event.target.value)} placeholder={cashMode === 'percent' ? 'Ví dụ: 10' : 'Ví dụ: 1000'}/><SoftSelect aria-label="Đơn vị cổ tức tiền mặt" value={cashMode} onChange={event => changeCashMode(event.target.value as 'percent' | 'vnd')}><option value="percent">% mệnh giá</option><option value="vnd">đồng/CP</option></SoftSelect></div><small>{cashMode === 'percent' ? '10% mệnh giá = 1.000 đồng/CP' : 'Số tiền trước thuế trên mỗi cổ phiếu'}</small></div>
            <label className="ex-rights-field">Cổ tức cổ phiếu / thưởng<div className="ex-rights-input-row"><input type="number" inputMode="decimal" min="0" step="any" value={stock} onChange={event => setStock(event.target.value)} placeholder="Ví dụ: 20"/><span>%</span></div><small>10:2 = 20%</small></label>
            <div className="ex-rights-rights-column"><label className="ex-rights-field">Quyền mua thêm<div className="ex-rights-input-row"><input type="number" inputMode="decimal" min="0" step="any" value={rights} onChange={event => setRights(event.target.value)} placeholder="Ví dụ: 20"/><span>%</span></div></label><label className="ex-rights-field">Giá thực hiện quyền mua<div className="ex-rights-input-row"><input type="number" inputMode="decimal" min="0" step="any" value={rightsPrice} onChange={event => setRightsPrice(event.target.value)} placeholder="Ví dụ: 10000"/><span>đồng</span></div></label></div>
          </div>
          <details className="ex-rights-advanced"><summary>Tách / gộp cổ phiếu và trường hợp khác</summary><label className="ex-rights-field">Số cổ phiếu sau trên 1 cổ phiếu trước<input type="number" inputMode="decimal" min="0" step="any" value={split} onChange={event => setSplit(event.target.value)} placeholder="Tách 1:2 nhập 2"/></label><p>Cổ tức bằng tài sản, cổ phiếu quỹ và sự kiện đặc biệt cần đối chiếu thông báo của Sở.</p></details>
          {rightsException && <p className="ex-rights-alert"><Info size={16}/> Giá mua thêm không thấp hơn giá đã điều chỉnh các quyền khác. Sở có thể không điều chỉnh riêng quyền mua; kết quả chỉ là phép pha loãng lý thuyết.</p>}
          {cashValue > 0 && price != null && cashValue >= price && <p className="ex-rights-alert">Cổ tức tiền mặt bằng hoặc lớn hơn giá trước quyền: cần đối chiếu giá do Sở công bố.</p>}
          <div className="ex-rights-result" aria-live="polite"><span>GIÁ LÝ THUYẾT SAU QUYỀN</span><strong>{result == null ? '—' : formatVnd(result, 2)}</strong><small>{result == null ? !hasRight ? 'Nhập ít nhất một tỷ lệ để xem kết quả.' : 'Kiểm tra giá và các tỷ lệ đã nhập.' : `Thay đổi ${formatVnd(result - price!, 2)} (${((result / price! - 1) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%) so với giá trước quyền`}</small></div>
          {result != null && <p className="ex-rights-formula">({formatVnd(price!, 0)} − {formatVnd(cashValue, 0)} + {(rightsRate * readNumber(rightsPrice)).toLocaleString('vi-VN')} đồng) ÷ [(1 + {stockRate.toLocaleString('vi-VN')} + {rightsRate.toLocaleString('vi-VN')}) × {splitRate.toLocaleString('vi-VN')}]</p>}
          <p className="ex-rights-footnote">Ước tính từ {useManualPrice ? 'giá tự nhập' : `EOD ${priceQuery.data?.trading_date ? formatDate(priceQuery.data.trading_date) : 'chưa xác định'}`}. Giá tham chiếu chính thức, bước giá và làm tròn do Sở giao dịch xác định.</p>
        </div>
      </section>
    </div>, document.body)}
  </>
}
