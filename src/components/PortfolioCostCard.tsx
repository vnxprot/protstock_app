import { FormEvent, useEffect, useState } from 'react'
import { DateField } from './DateField'
import { COST_START_DATE, SSI_DEFAULT_RATE, type CostRate } from '../lib/portfolioCosts'

const percent = (value: number) => `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 5 })}%`

export function PortfolioCostCard({ rates, loading, error, onRetry, onSave }: {
  rates: CostRate[]; loading: boolean; error: boolean; onRetry: () => void;
  onSave: (rate: CostRate) => Promise<void>
}) {
  const [date, setDate] = useState(COST_START_DATE)
  const [buyFee, setBuyFee] = useState(SSI_DEFAULT_RATE.buy_fee_pct)
  const [sellFee, setSellFee] = useState(SSI_DEFAULT_RATE.sell_fee_pct)
  const [sellTax, setSellTax] = useState(SSI_DEFAULT_RATE.sell_tax_pct)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const initial = rates.find(rate => rate.effective_date === date)
    if (initial) { setBuyFee(Number(initial.buy_fee_pct)); setSellFee(Number(initial.sell_fee_pct)); setSellTax(Number(initial.sell_tax_pct)) }
  }, [date, rates])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (date < COST_START_DATE || [buyFee, sellFee, sellTax].some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
      setMessage('Kiểm tra ngày hiệu lực và các tỷ lệ từ 0% đến 100%.')
      return
    }
    setSaving(true); setMessage('')
    try {
      await onSave({ effective_date: date, buy_fee_pct: buyFee, sell_fee_pct: sellFee, sell_tax_pct: sellTax, source_note: 'Tự nhập; đối chiếu với biểu phí và sao kê SSI.' })
      setMessage('Đã lưu biểu phí. Toàn bộ giao dịch từ ngày hiệu lực đã được tính lại.')
    } catch { setMessage('Chưa lưu được biểu phí. Kiểm tra kết nối và thử lại.') }
    finally { setSaving(false) }
  }
  return <article className="panel portfolio-cost-card">
    <div className="panel-title"><h3>Phí, thuế &amp; Lãi/Lỗ</h3><span>Áp dụng từ 01/09/2026</span></div>
    <p className="muted">Mẫu SSI: giao dịch chủ động online dưới 100 triệu đồng/ngày/tài khoản. Nếu tài khoản, kênh đặt lệnh hoặc tổng giao dịch trong ngày của bạn khác, hãy sửa tỷ lệ hoặc nhập phí thực tế trong từng giao dịch.</p>
    <form className="portfolio-cost-form" onSubmit={submit}>
      <DateField label="Ngày hiệu lực" value={date} onChange={setDate}/>
      <label>Phí mua (%)<input type="number" min="0" max="100" step="0.00001" value={buyFee} onChange={event => setBuyFee(Number(event.target.value))}/></label>
      <label>Phí bán (%)<input type="number" min="0" max="100" step="0.00001" value={sellFee} onChange={event => setSellFee(Number(event.target.value))}/></label>
      <label>Thuế TNCN khi bán (%)<input type="number" min="0" max="100" step="0.00001" value={sellTax} onChange={event => setSellTax(Number(event.target.value))}/></label>
      <button className="secondary-button" disabled={saving || loading}>{saving ? 'Đang lưu…' : 'Lưu mức phí'}</button>
    </form>
    {message && <p role="status" className={message.startsWith('Chưa') || message.startsWith('Kiểm') ? 'form-error' : 'muted'}>{message}</p>}
    {error && <p className="form-error" role="alert">Không tải được biểu phí đã lưu. <button type="button" onClick={onRetry}>Thử lại</button></p>}
    <div className="portfolio-cost-history"><strong>Các mức theo thời kỳ</strong><span>01/09/2026 · Mẫu SSI nếu chưa lưu mức cùng ngày: mua {percent(0.15)}, bán {percent(0.15)}, thuế {percent(0.1)}</span>{rates.map(rate => <button type="button" key={rate.effective_date} onClick={() => { setDate(rate.effective_date); setBuyFee(Number(rate.buy_fee_pct)); setSellFee(Number(rate.sell_fee_pct)); setSellTax(Number(rate.sell_tax_pct)) }}>{rate.effective_date.split('-').reverse().join('/')} · Mua {percent(rate.buy_fee_pct)} · Bán {percent(rate.sell_fee_pct)} · Thuế {percent(rate.sell_tax_pct)} (sửa)</button>)}</div>
    <p className="portfolio-cost-formula"><strong>Công thức:</strong> Giá vốn bình quân = (tổng tiền mua + phí mua) / số cổ phiếu. Lãi/Lỗ đã bán = tiền bán − phí bán − thuế TNCN trên tiền bán − giá vốn của số cổ phiếu bán. Lãi/Lỗ đang nắm giữ = giá trị thị trường − giá vốn gồm phí mua; chưa trừ chi phí của lệnh bán chưa xảy ra. Tiền mặt và NAV trừ chi phí tại ngày giao dịch. Phí ước tính được làm tròn đến đồng; số thực tế nhập tại giao dịch được ưu tiên.</p>
    <small className="muted">Nguồn: <a href="https://www.ssi.com.vn/khach-hang-ca-nhan/bieu-phi/bieu-gia-dich-vu-giao-dich-chu-dong" target="_blank" rel="noreferrer">biểu phí SSI</a> và <a href="https://xaydungchinhsach.chinhphu.vn/thue-thu-nhap-ca-nhan-doi-voi-thu-nhap-tu-chuyen-nhuong-chung-khoan-119260703164200344.htm" target="_blank" rel="noreferrer">quy định thuế TNCN</a>. Giao dịch trước 01/09/2026 giữ cách tính cũ.</small>
  </article>
}
