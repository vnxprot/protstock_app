import { useState, type FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { DateField } from './DateField'

export function ReplayPanel() {
  const [date,setDate] = useState(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))
  const [state,setState] = useState<'idle'|'running'|'queued'|'error'>('idle')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!date || !supabase) return
    setState('running')
    try {
      const {data} = await supabase.auth.getSession()
      if (!data.session) throw new Error('No session')
      const result = await fetch('/api/rebuild-signals',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({tradingDate:date,sendTelegram:false})})
      if (!result.ok) throw new Error('Dispatch failed')
      setState('queued')
    } catch { setState('error') }
  }
  return <section className="replay-panel"><div><h3>Vận hành tín hiệu</h3><p>Chạy lại từ dữ liệu đã có. Không tải lại giá; mặc định không gửi Telegram.</p></div><form onSubmit={submit} className="replay-form"><DateField value={date} onChange={value=>{setDate(value);setState('idle')}} label="Ngày chạy lại tín hiệu"/><button className="replay-submit" type="submit" disabled={!date||state==='running'}><RefreshCw size={16}/>{state==='running'?'Đang đưa vào hàng đợi…':'Chạy lại tín hiệu'}</button></form><div role="status" aria-live="polite">{state==='queued'&&<p className="positive">Đã đưa vào hàng đợi. Pipeline tự xử lý; không cần bấm lại.</p>}{state==='error'&&<p className="negative">Không thể đưa vào hàng đợi. Kiểm tra kết nối và thử lại.</p>}</div></section>
}
