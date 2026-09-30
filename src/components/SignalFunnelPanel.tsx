import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './SignalFunnelPanel.css'

type FunnelRow = {
  symbol: string
  monthly_state: string
  stage: string
  setup_kind: string | null
  setup_date: string | null
  trigger_date: string | null
  reasons: string[]
}

const stageNames: Record<string, string> = {
  MONTHLY_CONTEXT: 'Bối cảnh tháng',
  WEEKLY_READY: 'Setup tuần sẵn sàng',
  DAILY_TRIGGER: 'Kích hoạt ngày',
  TRIGGERED_EARLIER: 'Đã kích hoạt trước đó',
  DATA_QUARANTINED: 'Dữ liệu cần kiểm tra',
}

export function SignalFunnelPanel({ date, authenticated }: { date: string; authenticated: boolean }) {
  const [stage, setStage] = useState('ALL')
  const [page, setPage] = useState(1)
  const funnel = useQuery({
    queryKey: ['shadow-funnel', date],
    enabled: authenticated && Boolean(supabase) && Boolean(date),
    queryFn: async (): Promise<FunnelRow[]> => {
      const { data, error } = await supabase!.from('signal_funnel_assessments')
        .select('monthly_state,stage,setup_kind,setup_date,trigger_date,reasons,symbols!inner(symbol)')
        .eq('as_of_date', date).eq('version', 'MTF_FUNNEL_SHADOW_V1')
        .order('symbol_id')
      if (error) throw error
      return (data ?? []).map((item: any) => ({
        symbol: (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol ?? '—',
        monthly_state: item.monthly_state,
        stage: item.stage,
        setup_kind: item.setup_kind,
        setup_date: item.setup_date,
        trigger_date: item.trigger_date,
        reasons: item.reasons ?? [],
      }))
    },
  })
  const rows = funnel.data ?? []
  const counts = useMemo(() => rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.stage] = (acc[row.stage] ?? 0) + 1
    return acc
  }, {}), [rows])
  const filtered = stage === 'ALL' ? rows : rows.filter(row => row.stage === stage)
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const visible = filtered.slice((Math.min(page, pages) - 1) * 10, Math.min(page, pages) * 10)

  return <article className="panel signal-funnel-panel">
    <div className="panel-title"><div><h3>Phễu tháng → tuần → ngày</h3><p className="muted">Bản nghiên cứu song song · chưa quyết định tín hiệu giao dịch</p></div><span>{date}</span></div>
    {funnel.isError && <p className="muted">Không tải được phễu nghiên cứu.</p>}
    {funnel.isLoading && <p className="muted">Đang tải phễu nghiên cứu…</p>}
    {!funnel.isLoading && !funnel.isError && <>
      <div className="signal-funnel-counts">
        <button type="button" className={stage === 'ALL' ? 'selected' : ''} onClick={() => { setStage('ALL'); setPage(1) }}>Tất cả <strong>{rows.length}</strong></button>
        {Object.entries(stageNames).map(([key, label]) => <button type="button" key={key} className={stage === key ? 'selected' : ''} onClick={() => { setStage(key); setPage(1) }}>{label} <strong>{counts[key] ?? 0}</strong></button>)}
      </div>
      <div className="signal-funnel-table">
        <div className="signal-funnel-head"><span>Mã</span><span>Tháng</span><span>Giai đoạn</span><span>Setup tuần</span><span>Ngày kích hoạt</span><span>Lý do</span></div>
        {visible.map(row => <div className="signal-funnel-row" key={row.symbol}>
          <strong>{row.symbol}</strong><span>{row.monthly_state}</span><span>{stageNames[row.stage] ?? row.stage}</span>
          <span>{row.setup_kind ? `${row.setup_kind} · ${row.setup_date}` : '—'}</span>
          <span>{row.trigger_date ?? '—'}</span><small>{row.reasons.join(' · ')}</small>
        </div>)}
      </div>
      <div className="signal-funnel-pagination"><span>{filtered.length} mã · Trang {Math.min(page, pages)}/{pages}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Trước</button><button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Sau</button></div></div>
    </>}
  </article>
}
