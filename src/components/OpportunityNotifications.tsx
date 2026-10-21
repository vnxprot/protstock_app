import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import './opportunities.css'

type Preferences = { enabled: boolean; system_alerts: boolean; scope: 'ALL' | 'WATCHLIST'; max_symbols: number }
const defaults: Preferences = { enabled: true, system_alerts: true, scope: 'ALL', max_symbols: 5 }
export function OpportunityNotifications({ userId }: { userId: string }) {
  const [prefs, setPrefs] = useState<Preferences>(defaults)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const result = useQuery({ queryKey: ['opportunity-notifications', userId], enabled: Boolean(supabase) && Boolean(userId), queryFn: async () => {
    const [settings, logs] = await Promise.all([
      supabase!.from('opportunity_notification_settings').select('enabled,system_alerts,scope,max_symbols').eq('user_id', userId).maybeSingle(),
      supabase!.from('opportunity_notifications').select('trading_date,status,publication_id,updated_at').eq('user_id', userId).order('trading_date', { ascending: false }).limit(10),
    ])
    if (settings.error) throw settings.error
    if (logs.error) throw logs.error
    return { prefs: (settings.data ?? defaults) as Preferences, logs: logs.data ?? [] }
  } })
  useEffect(() => { if (result.data) setPrefs(result.data.prefs) }, [result.data])
  async function save() {
    setBusy(true); setNotice('')
    try {
      const { error } = await supabase!.from('opportunity_notification_settings').upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() })
      if (error) throw error
      setNotice('Đã lưu tùy chọn. Áp dụng cho các bản tin tiếp theo.'); await result.refetch()
    } catch { setNotice('Chưa lưu được tùy chọn. Hãy thử lại.') }
    finally { setBusy(false) }
  }
  return <article className="panel opportunity-settings"><h2>Thông báo Telegram</h2><p>Bot và cuộc trò chuyện đã cấu hình cho tài khoản Prot. Một bản tổng hợp cơ hội mỗi phiên, sau khi EOD và Radar đã công bố.</p>
    {result.isLoading && <p>Đang tải tùy chọn…</p>}{result.isError && <p role="alert">Chưa tải được tùy chọn. <button type="button" className="text-button" onClick={() => void result.refetch()}>Thử lại</button></p>}
    <fieldset disabled={busy || !result.isSuccess} className="opportunity-settings"><label><input type="checkbox" checked={prefs.system_alerts} onChange={event => setPrefs(value => ({ ...value, system_alerts: event.target.checked }))}/> Tín hiệu mua/bán của hệ thống</label>
      <label><input type="checkbox" checked={prefs.enabled} onChange={event => setPrefs(value => ({ ...value, enabled: event.target.checked }))}/> Cơ hội phiên tới</label>
      <label>Phạm vi cơ hội<select value={prefs.scope} onChange={event => setPrefs(value => ({ ...value, scope: event.target.value as Preferences['scope'] }))}><option value="ALL">Toàn bộ danh sách cổ phiếu Prot</option><option value="WATCHLIST">Chỉ Watchlist đang bật</option></select></label>
      <label>Số mã tối đa mỗi bản tin<select value={prefs.max_symbols} onChange={event => setPrefs(value => ({ ...value, max_symbols: Number(event.target.value) }))}>{[1,2,3,4,5].map(n => <option value={n} key={n}>{n} mã</option>)}</select></label>
      <button type="button" className="primary-button" onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu tùy chọn'}</button></fieldset>
    {notice && <p role="status">{notice}</p>}<small>Chỉ gửi khi có bằng chứng mới đáng chú ý. Chạy bù lịch sử không gửi bản tin. Không tự gửi lại khi chưa xác định được lần gửi trước đã thành công hay chưa.</small>
    <h3>Lịch sử bản tin cơ hội</h3><div className="opportunity-deliveries">{result.data?.logs.map(log => <a key={log.trading_date} href={`#screener?section=opportunities&date=${log.trading_date}&publication=${log.publication_id}`}><span>{formatDate(log.trading_date)}</span><span>{{ SENT: 'Đã gửi', CLAIMED: 'Đang gửi', FAILED: 'Gửi thất bại', UNKNOWN: 'Cần kiểm tra kết quả gửi' }[log.status as string] ?? log.status}</span></a>)}{result.isSuccess && !result.data?.logs.length && <p>Chưa có bản tin cơ hội được gửi.</p>}</div>
  </article>
}
