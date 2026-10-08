import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ResearchPagination } from './ResearchPagination'
import { SoftSelect } from './SoftSelect'
import './MomentumRadarPanel.css'

type Milestone = { date: string; kind: string; close: number; level?: number; volume_ratio_20?: number; weekly_volume_ratio_13?: number }
type Evidence = { close?: number; volume?: number; volume_ratio_20?: number; daily_return_pct?: number;
  monthly_state?: string; distance_to_stop_pct?: number | null; milestones?: Milestone[] }
type Row = { symbol_id: number; symbol: string; as_of_date: string; event_id: string | null;
  event_start_date: string | null; breakout_date: string | null; weekly_confirmed_date: string | null;
  reacceleration_date: string | null; breakout_level: number | null; structural_stop: number | null;
  stage: string; entry_status: string; reasons: string[]; evidence: Evidence }

const stageNames: Record<string, string> = {
  SURGE_WATCH: 'Đột biến đáng chú ý', DAILY_BREAKOUT: 'Breakout ngày',
  WEEKLY_CONFIRMED: 'Tuần xác nhận', CONTINUING: 'Đang tiếp diễn',
  REACCELERATING: 'Tăng tốc lại', INVALIDATED: 'Mất hiệu lực',
  DATA_CHECK: 'Cần kiểm tra dữ liệu', NO_EVENT: 'Chưa có sự kiện',
  WEEKLY_CONTINUATION: 'Tuần tiếp diễn',
}
const activeStages = new Set(['SURGE_WATCH', 'DAILY_BREAKOUT', 'WEEKLY_CONFIRMED', 'CONTINUING', 'REACCELERATING'])
const hasNewMilestone = (row: Row) => row.evidence?.milestones?.some(item => item.date === row.as_of_date) ?? false
const priority: Record<string, number> = { REACCELERATING: 0, DAILY_BREAKOUT: 1, WEEKLY_CONFIRMED: 2, SURGE_WATCH: 3, CONTINUING: 4, INVALIDATED: 5, DATA_CHECK: 6, NO_EVENT: 7 }
const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits })
const day = (value: string | null | undefined) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : '—'

function entryText(row: Row) {
  if (row.entry_status === 'EXTENDED') return `Chưa có điểm vào: xa stop ${number(row.evidence?.distance_to_stop_pct)}% (giới hạn nghiên cứu 8%)`
  if (row.entry_status === 'RISK_WINDOW') return 'Khoảng cách stop đạt sơ bộ; vẫn cần kiểm tra thị trường và tín hiệu giao dịch'
  if (row.entry_status === 'DATA_CHECK') return 'Dữ liệu giá cần được xác minh'
  return 'Theo dõi cấu trúc; chưa có điểm vào được xác nhận'
}

export function MomentumRadarPanel({ date }: { date: string }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('ACTIVE')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const query = useQuery({ queryKey: ['momentum-radar', date], enabled: Boolean(supabase) && Boolean(date), queryFn: async (): Promise<Row[]> => {
    const result: Row[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('momentum_radar_assessments')
        .select('symbol_id,as_of_date,event_id,event_start_date,breakout_date,weekly_confirmed_date,reacceleration_date,breakout_level,structural_stop,stage,entry_status,reasons,evidence,symbols!inner(symbol)')
        .eq('as_of_date', date).eq('version', 'MOMENTUM_RADAR_V1').order('symbol_id').range(from, from + 999)
      if (error) throw error
      result.push(...(data ?? []).map((item: any) => ({ ...item,
        symbol: (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol ?? `#${item.symbol_id}` })))
      if ((data ?? []).length < 1000) break
    }
    return result
  } })
  const all = query.data ?? []
  const counts = useMemo(() => ({ active: all.filter(row => activeStages.has(row.stage)).length,
    extended: all.filter(row => activeStages.has(row.stage) && row.entry_status === 'EXTENDED').length,
    new: all.filter(row => activeStages.has(row.stage) && hasNewMilestone(row)).length }), [all])
  const rows = all.filter(row => row.symbol.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))
    && (filter === 'ALL' || filter === 'ACTIVE' && activeStages.has(row.stage)
      || filter === 'NEW' && activeStages.has(row.stage) && hasNewMilestone(row)
      || filter === 'EXTENDED' && row.entry_status === 'EXTENDED' && activeStages.has(row.stage)
      || filter === row.stage))
    .sort((a, b) => (priority[a.stage] ?? 9) - (priority[b.stage] ?? 9)
      || (b.evidence?.volume_ratio_20 ?? 0) - (a.evidence?.volume_ratio_20 ?? 0)
      || a.symbol.localeCompare(b.symbol))
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  return <article className="panel momentum-radar-panel" id="screener-panel-radar" role="tabpanel" aria-labelledby="screener-tab-radar">
    <div className="panel-title"><div><h3>Radar đà tăng</h3><p className="muted">Phát hiện → diễn biến → rủi ro điểm vào. Một sự kiện được theo dõi xuyên phiên.</p></div><span>{day(date)}</span></div>
    <p className="muted">Dữ liệu cuối ngày (EOD). Radar là nghiên cứu, không tự tạo lệnh mua; khối lượng giao dịch không phải tiền mua ròng.</p>
    <div className="radar-summary"><span><b>{counts.active}</b> sự kiện đang theo dõi</span><span><b>{counts.new}</b> mốc mới phiên này</span><span><b>{counts.extended}</b> quá xa stop</span></div>
    <div className="radar-filters"><label>Mã <input value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Tìm mã…" /></label>
      <label>Giai đoạn <SoftSelect value={filter} onChange={event => { setFilter(event.target.value); setPage(1) }}>
        <option value="ACTIVE">Đang theo dõi</option><option value="NEW">Mốc mới phiên này</option><option value="EXTENDED">Quá xa stop</option>
        {Object.entries(stageNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}<option value="ALL">Tất cả</option>
      </SoftSelect></label><span>{rows.length} mã · trang {current}/{pages}</span></div>
    {query.isLoading && <p>Đang tải Radar…</p>}
    {query.isError && <p className="form-error" role="alert">Không tải được Radar đà tăng. <button className="text-button" onClick={() => void query.refetch()}>Thử lại</button></p>}
    {!query.isLoading && !query.isError && <><div className="radar-list">{rows.slice((current - 1) * pageSize, current * pageSize).map(row => <section className="radar-card" key={row.symbol_id}>
      <header><div><strong>{row.symbol}</strong><small>Phát hiện từ {day(row.event_start_date)} · {row.evidence?.monthly_state ? `Tháng ${row.evidence.monthly_state}` : 'Chưa có bối cảnh tháng'}</small></div><b>{stageNames[row.stage] ?? row.stage}</b></header>
      <div className="radar-columns"><div><small>PHÁT HIỆN</small><p>Close <b>{number(row.evidence?.close)}</b> · Volume <b>{number(row.evidence?.volume_ratio_20)}×</b> TB20</p><p>Biến động ngày <b>{row.evidence?.daily_return_pct == null ? '—' : `${number(row.evidence.daily_return_pct)}%`}</b></p></div>
        <div><small>DIỄN BIẾN</small><p>Breakout {day(row.breakout_date)} tại <b>{number(row.breakout_level)}</b></p><p>Xác nhận tuần {day(row.weekly_confirmed_date)} · Tăng tốc {day(row.reacceleration_date)}</p></div>
        <div><small>ĐIỂM VÀO &amp; RỦI RO</small><p>Stop cấu trúc <b>{number(row.structural_stop)}</b></p><p className={row.entry_status === 'EXTENDED' ? 'radar-risk' : ''}>{entryText(row)}</p></div></div>
      {!!row.evidence?.milestones?.length && <details><summary>Xem diễn biến ({row.evidence.milestones.length} mốc)</summary><ol>{row.evidence.milestones.map((milestone, index) => <li key={`${milestone.date}-${milestone.kind}-${index}`}><time>{day(milestone.date)}</time><b>{stageNames[milestone.kind] ?? milestone.kind}</b><span>Close {number(milestone.close)}{milestone.level != null ? ` · Ngưỡng ${number(milestone.level)}` : ''}{milestone.volume_ratio_20 != null ? ` · Volume ${number(milestone.volume_ratio_20)}×` : ''}{milestone.weekly_volume_ratio_13 != null ? ` · Volume tuần ${number(milestone.weekly_volume_ratio_13)}×` : ''}</span></li>)}</ol></details>}
    </section>)}</div>
      {!rows.length && <p className="muted">{all.length ? 'Không có mã khớp bộ lọc.' : `Phiên ${day(date)} chưa có dữ liệu Radar.`}</p>}
      <ResearchPagination label="Phân trang Radar đà tăng" page={current} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }}/>
    </>}
  </article>
}
