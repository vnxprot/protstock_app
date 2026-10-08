import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Filter, Search, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SoftSelect } from './SoftSelect'
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
  WEEKLY_READY: 'Setup tuần',
  DAILY_TRIGGER: 'Kích hoạt ngày',
  TRIGGERED_EARLIER: 'Kích hoạt trước đó',
  DATA_QUARANTINED: 'Dữ liệu cần kiểm tra',
}

export function SignalFunnelPanel({ date, authenticated }: { date: string; authenticated: boolean }) {
  const [stage, setStage] = useState('ALL')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [monthlyState, setMonthlyState] = useState('ALL')
  const funnel = useQuery({
    queryKey: ['shadow-funnel', date],
    enabled: authenticated && Boolean(supabase) && Boolean(date),
    queryFn: async (): Promise<FunnelRow[]> => {
      const result: FunnelRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase!.from('signal_funnel_assessments')
          .select('monthly_state,stage,setup_kind,setup_date,trigger_date,reasons,symbols!inner(symbol)')
          .eq('as_of_date', date).eq('version', 'MTF_FUNNEL_SHADOW_V2')
          .order('symbol_id').range(from, from + 999)
        if (error) throw error
        result.push(...(data ?? []).map((item: any) => ({
        symbol: (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol ?? '—',
        monthly_state: item.monthly_state,
        stage: item.stage,
        setup_kind: item.setup_kind,
        setup_date: item.setup_date,
        trigger_date: item.trigger_date,
        reasons: item.reasons ?? [],
        })))
        if ((data ?? []).length < 1000) break
      }
      return result
    },
  })
  const rows = funnel.data ?? []
  const counts = useMemo(() => rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.stage] = (acc[row.stage] ?? 0) + 1
    return acc
  }, {}), [rows])
  const monthlyStates = useMemo(() => [...new Set(rows.map(row => row.monthly_state))].sort(), [rows])
  const filtered = rows.filter(row => (stage === 'ALL' || row.stage === stage)
    && row.symbol.toLocaleLowerCase('vi').includes(symbol.trim().toLocaleLowerCase('vi'))
    && (monthlyState === 'ALL' || row.monthly_state === monthlyState))
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)

  return <article className="panel signal-funnel-panel">
    <div className="panel-title"><div><h3>Phễu tháng → tuần → ngày v2.0.1</h3><p className="muted">Bản nghiên cứu song song · nhận diện breakout ngay khi tuần đóng · chưa quyết định tín hiệu giao dịch</p></div><span>{date}</span></div>
    {funnel.isError && <p className="muted">Không tải được phễu nghiên cứu.</p>}
    {funnel.isLoading && <p className="muted">Đang tải phễu nghiên cứu…</p>}
    {!funnel.isLoading && !funnel.isError && <>
      <div className="signal-funnel-counts" role="group" aria-label="Lọc giai đoạn phễu">{[['ALL','Tất cả',rows.length],...Object.entries(stageNames).map(([key,label])=>[key,label,counts[key]??0])] .map(([key,label,count])=><button type="button" key={key} className={stage===key?'selected':''} aria-pressed={stage===key} onClick={()=>{setStage(String(key));setPage(1)}}>{label} ({count})</button>)}<button type="button" className={filtersOpen?'signal-funnel-filter-toggle selected':'signal-funnel-filter-toggle'} aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(value=>!value)}><SlidersHorizontal size={15}/> Bộ lọc{symbol||monthlyState!=='ALL'?' •':''}</button></div>
      {filtersOpen&&<div className="signal-funnel-column-filters"><label className="screener-field"><Search size={16}/><input aria-label="Lọc mã phễu" placeholder="Mã…" value={symbol} onChange={event=>{setSymbol(event.target.value);setPage(1)}}/></label><label className="screener-field"><Filter size={16}/><SoftSelect aria-label="Lọc trạng thái tháng" value={monthlyState} onChange={event=>{setMonthlyState(event.target.value);setPage(1)}}><option value="ALL">Mọi trạng thái tháng</option>{monthlyStates.map(value=><option key={value} value={value}>{value}</option>)}</SoftSelect></label></div>}
      <div className="signal-funnel-table">
        <div className="signal-funnel-head"><span>Mã</span><span>Tháng</span><span>Giai đoạn</span><span>Setup tuần</span><span>Ngày kích hoạt</span><span>Lý do</span></div>
        {visible.map(row => <div className="signal-funnel-row" key={row.symbol}>
          <strong>{row.symbol}</strong><span>{row.monthly_state}</span><span>{stageNames[row.stage] ?? row.stage}</span>
          <span>{row.setup_kind ? `${row.setup_kind} · ${row.setup_date}` : '—'}</span>
          <span>{row.trigger_date ?? '—'}</span><small>{row.reasons.join(' · ')}</small>
        </div>)}
      </div>
      <nav className="screener-pagination" aria-label="Phân trang phễu tháng tuần ngày"><span>Hiển thị <SoftSelect aria-label="Số mã mỗi trang" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1)}}><option value="25">25</option><option value="50">50</option><option value="100">100</option></SoftSelect> / trang · {filtered.length} mã</span><div><button type="button" disabled={current===1} onClick={()=>setPage(1)}>Đầu</button><button type="button" disabled={current===1} onClick={()=>setPage(current-1)}>‹ Trước</button><b>Trang {current}/{pages}</b><button type="button" disabled={current===pages} onClick={()=>setPage(current+1)}>Sau ›</button><button type="button" disabled={current===pages} onClick={()=>setPage(pages)}>Cuối</button></div></nav>
    </>}
  </article>
}
