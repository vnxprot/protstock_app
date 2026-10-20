import { useState } from 'react'
import type { DividendReceipt, PortfolioEntitlement } from '../lib/portfolioLedger'
import { formatDate, todayInVietnam } from '../lib/date'
import { formatVnd } from '../lib/marketUnits'
import { CurrencyInput } from './CurrencyInput'
import { DateField } from './DateField'

export function PortfolioEntitlements({entitlements,receipts,onSave}:{entitlements:PortfolioEntitlement[];receipts:DividendReceipt[];onSave:(item:PortfolioEntitlement,day:string,cash:number)=>Promise<void>}) {
  const [editing,setEditing]=useState<PortfolioEntitlement|null>(null)
  const [day,setDay]=useState(todayInVietnam())
  const [cash,setCash]=useState(0)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  if(!entitlements.length) return null
  return <article className="panel"><div className="panel-title"><h3>Cổ tức và quyền</h3><span>{entitlements.length} sự kiện</span></div>
    <p className="muted">Sự kiện theo nguồn dữ liệu, không chặn định giá. Cổ tức phải thu tính trước thuế và nằm riêng với tiền mặt. Tiền mặt chỉ tăng khi ghi nhận số tiền thực nhận; quyền cổ phiếu hiển thị riêng theo sổ giao dịch.</p>
    {entitlements.map(item=>{
      const key=String(item.symbol_id)+':'+item.ex_date+':'+item.action_type
      const receipt=receipts.find(row=>String(row.symbol_id)===String(item.symbol_id)&&row.ex_date===item.ex_date)
      return <div key={key} className="capital-ledger-row"><span><b>{item.symbol}</b> · Ngày quyền {formatDate(item.ex_date)}<small> · {item.action_type==='CASH_DIVIDEND'?'Cổ tức tiền mặt': 'Quyền cổ phiếu'} · {item.source.startsWith('VCI')?'VCI':'KBS'}</small></span>
        <span>{item.action_type==='CASH_DIVIDEND'?(receipt?`Đã nhận ${formatVnd(Number(receipt.net_cash))} · ${formatDate(receipt.received_date)}`:`Phải thu ${item.expected_cash==null?'chưa có số tiền từ nguồn':formatVnd(Number(item.expected_cash))}`):`${Number(item.quantity).toLocaleString('vi-VN')} CP tại ngày quyền${item.ratio!=null?` · Tỷ lệ ${Number(item.ratio)*100}%`:''}`}</span>
        {item.action_type==='CASH_DIVIDEND'&&<button className="text-button" onClick={()=>{setEditing(item);setDay(receipt?.received_date??todayInVietnam());setCash(receipt?Number(receipt.net_cash):0);setError('')}}>{receipt?'Sửa thực nhận':'Ghi tiền thực nhận'}</button>}
      </div>
    })}
    {editing&&<form className="rule-form" onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{await onSave(editing,day,cash);setEditing(null)}catch{setError('Không lưu được tiền thực nhận. Kiểm tra ngày và số tiền rồi thử lại.')}finally{setBusy(false)}}}>
      <strong>{editing.symbol} · Cổ tức ngày {formatDate(editing.ex_date)}</strong>
      <DateField label="Ngày thực nhận" value={day} onChange={setDay}/>
      <CurrencyInput label="Số tiền thực nhận sau khấu trừ" value={cash} onChange={setCash}/>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="button-row"><button type="button" className="secondary-button" disabled={busy} onClick={()=>setEditing(null)}>Đóng</button><button className="primary-button" disabled={busy||!day||day<editing.ex_date||day>todayInVietnam()||cash<0}>Lưu tiền thực nhận</button></div>
    </form>}
  </article>
}
