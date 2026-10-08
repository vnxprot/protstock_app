import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccountId } from '../hooks/useAccountId'
import { useStockThesis, type ThesisStatus, type ThesisVersion } from '../hooks/useStockThesis'
import { supabase } from '../lib/supabase'
import { formatDateTime } from '../lib/date'
import { SoftSelect } from './SoftSelect'

const statuses: Record<ThesisStatus, string> = { OBSERVATION: 'Đang quan sát', MAINTAIN: 'Giữ luận điểm', REVIEW: 'Cần xem lại', INVALIDATED: 'Đã vô hiệu' }
type Form = { thesis: string; catalysts: string; invalidation_conditions: string; risk_notes: string; review_status: ThesisStatus }
const empty: Form = { thesis: '', catalysts: '', invalidation_conditions: '', risk_notes: '', review_status: 'OBSERVATION' }

export function StockThesisPanel({ symbol, compact = false, authenticated = true, canJournal = true }: { symbol: string; compact?: boolean; authenticated?: boolean; canJournal?: boolean }) {
  const userId = useAccountId(authenticated)
  return <ThesisEditor key={`${userId}:${symbol}`} symbol={symbol} compact={compact} authenticated={authenticated} userId={userId} canJournal={canJournal}/>
}
function ThesisEditor({ symbol, compact, authenticated, userId, canJournal }: { symbol: string; compact: boolean; authenticated: boolean; userId: string | null; canJournal: boolean }) {
  const query = useStockThesis(symbol, authenticated); const client = useQueryClient()
  const [editing, setEditing] = useState(false); const [form, setForm] = useState<Form>(empty); const [dirty, setDirty] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false); const expected = useRef<string | null>(null)
  const storageKey = userId ? `protstock-thesis-draft:${userId}:${symbol}` : null
  useEffect(() => {
    if (!storageKey) return
    try { const saved = localStorage.getItem(storageKey); if (saved) { const draft = JSON.parse(saved); setForm({ ...empty, ...draft.form }); expected.current = draft.expected ?? null; setDirty(true); setEditing(true) } } catch { /* Preserve server state when local storage is unavailable. */ }
  }, [storageKey])
  useEffect(() => {
    if (query.isSuccess && !dirty) { setForm(query.data?.current_version ?? empty); expected.current = query.data?.current_version_id ?? null }
  }, [query.data, query.isSuccess, dirty])
  const change = (field: keyof Form, value: string) => {
    const next = { ...form, [field]: value } as Form; setForm(next); setDirty(true)
    if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify({ form: next, expected: expected.current })) } catch { /* Draft remains available for this session. */ }
  }
  const save = useMutation({ mutationFn: async () => {
    if (!supabase || !userId || !form.thesis.trim()) throw new Error('Nhập lý do đầu tư trước khi lưu.')
    const { data: instrument, error } = await supabase.from('symbols').select('id').eq('symbol', symbol).single(); if (error) throw error
    const response = await supabase.rpc('save_investment_thesis', { p_symbol_id: instrument.id, p_thesis: form.thesis, p_catalysts: form.catalysts, p_invalidation_conditions: form.invalidation_conditions, p_risk_notes: form.risk_notes, p_review_status: form.review_status, p_expected_version_id: expected.current, p_expected_user_id: userId })
    if (response.error) throw response.error
    expected.current = response.data as string
  }, onSuccess: async () => {
    if (storageKey) try { localStorage.removeItem(storageKey) } catch { /* Server version was saved even when storage is unavailable. */ }
    setDirty(false); setEditing(false)
    await client.invalidateQueries({ queryKey: ['stock-thesis', userId, symbol] })
    await client.invalidateQueries({ queryKey: ['thesis-history', userId, symbol] })
    await client.invalidateQueries({ queryKey: ['watchlist-theses'] })
  } })
  const history = useQuery({ queryKey: ['thesis-history', userId, symbol], enabled: historyOpen && Boolean(query.data?.id), queryFn: async () => {
    const { data, error } = await supabase!.from('investment_thesis_versions').select('*').eq('thesis_id', query.data!.id).order('version', { ascending: false }).limit(20); if (error) throw error; return data as ThesisVersion[]
  } })
  const reload = useCallback(async () => {
    const response = await query.refetch(); if (response.isError) return
    expected.current = response.data?.current_version_id ?? null; save.reset()
  }, [query, save])
  const current = query.data?.current_version
  if (!authenticated || !userId) return null
  return <article className={`panel thesis-panel${compact ? ' compact' : ''}`}>
    <div className="panel-title"><div><h3>Luận điểm đầu tư · {symbol}</h3><small>Ý kiến cá nhân · tách biệt với tín hiệu hệ thống</small></div>{current && <span>v{current.version} · {statuses[current.review_status]}</span>}</div>
    {query.isLoading ? <p role="status">Đang tải luận điểm…</p> : query.isError ? <p role="alert">Chưa tải được luận điểm. <button className="text-button" onClick={() => void query.refetch()}>Thử lại</button></p> : editing ? <form onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate() }} className="thesis-form">
      <label>Vì sao đầu tư?<textarea disabled={save.isPending} required maxLength={10000} rows={4} value={form.thesis} onChange={e => change('thesis', e.target.value)}/></label>
      <label>Chất xúc tác cần theo dõi<textarea disabled={save.isPending} rows={2} value={form.catalysts} onChange={e => change('catalysts', e.target.value)}/></label>
      <label>Khi nào luận điểm không còn đúng?<textarea disabled={save.isPending} rows={2} value={form.invalidation_conditions} onChange={e => change('invalidation_conditions', e.target.value)}/></label>
      <label>Rủi ro và giới hạn vị thế<textarea disabled={save.isPending} rows={2} value={form.risk_notes} onChange={e => change('risk_notes', e.target.value)}/></label>
      <label>Trạng thái<SoftSelect aria-label="Trạng thái luận điểm" disabled={save.isPending} value={form.review_status} onChange={e => change('review_status', e.target.value)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SoftSelect></label>
      {save.isError && <p role="alert" className="negative">{String((save.error as { message?: string })?.message).includes('THESIS_CONFLICT') ? <>Luận điểm đã thay đổi trên thiết bị khác. Bản nháp vẫn được giữ. <button type="button" className="text-button" onClick={() => void reload()}>Tải phiên bản mới để đối chiếu</button>{query.data?.current_version && <small>Phiên bản máy chủ: {query.data.current_version.thesis}</small>}</> : 'Chưa lưu được. Bản nháp vẫn được giữ; hãy thử lại.'}</p>}
      <div className="thesis-actions"><button className="primary-button" disabled={!form.thesis.trim() || save.isPending || query.isError}>{save.isPending ? 'Đang lưu…' : 'Lưu phiên bản mới'}</button><button type="button" className="text-button" disabled={save.isPending} onClick={() => setEditing(false)}>Thu gọn</button><small>{dirty ? 'Bản nháp trên thiết bị này' : 'Mỗi lần lưu tạo một phiên bản'}</small></div>
    </form> : <>
      {current ? <><p className="thesis-copy">{current.thesis}</p>{!compact && <dl className="thesis-details">{[['Chất xúc tác', current.catalysts], ['Điều kiện vô hiệu', current.invalidation_conditions], ['Rủi ro', current.risk_notes]].map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}<small>Cập nhật {formatDateTime(current.created_at)}</small></> : <p>Ghi lý do theo dõi, kỳ vọng và điều kiện vô hiệu để xem lại quyết định sau này.</p>}
      <div className="thesis-actions"><button className="secondary-button" onClick={() => setEditing(true)}>{dirty ? 'Tiếp tục bản nháp' : current ? 'Cập nhật luận điểm' : 'Viết luận điểm'}</button>{canJournal&&<a className="text-button" href={`#journal?symbol=${encodeURIComponent(symbol)}`}>Ghi nhật ký nhanh</a>}{current && <button className="text-button" onClick={() => setHistoryOpen(v => !v)} aria-expanded={historyOpen}>Lịch sử phiên bản</button>}</div>
    </>}
    {historyOpen && <div className="thesis-history">{history.isLoading ? <p>Đang tải lịch sử…</p> : history.isError ? <p role="alert">Chưa tải được lịch sử.</p> : history.data?.map(version => <details key={version.id}><summary>v{version.version} · {formatDateTime(version.created_at)} · {statuses[version.review_status]}</summary><p className="thesis-copy">{version.thesis}</p><p>Vô hiệu: {version.invalidation_conditions || 'Chưa ghi'}</p><p>Rủi ro: {version.risk_notes || 'Chưa ghi'}</p></details>)}</div>}
  </article>
}
