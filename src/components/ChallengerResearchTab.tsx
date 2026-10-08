import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ResearchPagination } from './ResearchPagination'
import { SoftSelect } from './SoftSelect'
import './ChallengerResearchTab.css'

type Code = 'ADAPTIVE_FUNNEL' | 'MACD_EARLY_ZONE' | 'DOWNTREND_SPRING'
type Evidence = {
  market_regime?: string; price_basis?: string; size_multiplier?: number; funnel_stage?: string
  monthly_state?: string; weekly_setup?: string | null; setup_id?: string | null
  stage?: string; oversold?: { rsi14?: number | null; lower_band_breach?: boolean; oversold?: boolean }
  candidate?: Record<string, string | number | boolean | null | number[]>
  distance_to_stop_pct?: number | null; order_participation_rate?: number | null
  max_portfolio_exposure_pct_downtrend?: number | null; downtrend_target?: string | null
}
type Row = { symbol_id: number; symbol: string; strategy_code: Code; action: string; reasons: string[]
  base_price: number | null; invalidation_price: number | null; evidence: Evidence }

const names: Record<Code, string> = {
  ADAPTIVE_FUNNEL: 'Phễu MTF thích ứng', MACD_EARLY_ZONE: 'MACD đáy 2 · vào sớm',
  DOWNTREND_SPRING: 'Spring · nhịp hồi phòng thủ',
}
const reasonNames: Record<string, string> = {
  NO_SECOND_LOW_MACD_CROSS: 'Chưa có đáy 2 và giao cắt MACD/Signal trong phiên EOD',
  MACD_SECOND_LOW_CROSS: 'Đáy 2 tạm thời, MACD cao hơn đáy 1 và vừa cắt lên Signal',
  REGIME_BLOCKED: 'Chế độ thị trường chưa cho phép nhánh này',
  DOWNTREND_OVERSOLD_REQUIRED: 'Downtrend cần RSI < 25 hoặc chạm biên Bollinger dưới',
  HIGH_PARTICIPATION_RISK: 'Lệnh dự kiến vượt 5% thanh khoản 20 phiên',
  INSUFFICIENT_LIQUIDITY: 'Thanh khoản không đạt cổng an toàn',
  CHASE_BLOCKED: 'Khoảng cách đến stop vượt 8% hoặc giá dưới stop',
  CHAMPION_EXIT_CONFLICT: 'Champion đang phát EXIT/REDUCE cho mã này',
  ADAPTIVE_DAILY_TRIGGER: 'Setup tuần đã có trigger xác nhận bằng nến ngày',
  NO_OVERSOLD_PANIC_SPRING: 'Chưa đồng thời có quá bán và Spring volume lớn lấy lại nền',
  DOWNTREND_PANIC_SPRING: 'Quét thủng đáy với volume ≥ 2× và nến kế tiếp lấy lại nền',
}
const number = (value: number | null | undefined) => value == null ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const stageNames: Record<string, string> = { MONTHLY_CONTEXT: 'Bối cảnh tháng', WEEKLY_READY: 'Setup tuần', DAILY_TRIGGER: 'Kích hoạt ngày', TRIGGERED_EARLIER: 'Kích hoạt trước đó', DATA_QUARANTINED: 'Dữ liệu cần kiểm tra' }
const stages = ['ALL', ...Object.keys(stageNames)]
const values = (items: (string | null | undefined)[]) => [...new Set(items.filter((value): value is string => Boolean(value)))].sort()

export function ChallengerResearchTab({ date, tab, focusSymbol = '' }: { date: string; tab: 'funnel' | 'macd'; focusSymbol?: string }) {
  const [search, setSearch] = useState('')
  useEffect(() => { if (focusSymbol) { setSearch(focusSymbol); setPage(1) } }, [focusSymbol])
  const [status, setStatus] = useState('ALL')
  const [stage, setStage] = useState('ALL')
  const [regime, setRegime] = useState('ALL')
  const [monthly, setMonthly] = useState('ALL')
  const [weekly, setWeekly] = useState('ALL')
  const [strategy, setStrategy] = useState('ALL')
  const [oversold, setOversold] = useState('ALL')
  const [maxDistance, setMaxDistance] = useState('')
  const [reason, setReason] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const codes: Code[] = tab === 'funnel' ? ['ADAPTIVE_FUNNEL'] : ['MACD_EARLY_ZONE', 'DOWNTREND_SPRING']
  const query = useQuery({ queryKey: ['challenger-research-tab', date, tab], enabled: Boolean(supabase) && Boolean(date), queryFn: async (): Promise<Row[]> => {
    const result: Row[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('challenger_strategy_assessments')
        .select('symbol_id,strategy_code,action,reasons,base_price,invalidation_price,evidence,symbols!inner(symbol)')
        .eq('trading_date', date).eq('engine_version', 'v2.0-challenger')
        .in('strategy_code', codes).order('symbol_id').range(from, from + 999)
      if (error) throw error
      result.push(...(data ?? []).map((item: any) => ({ ...item,
        symbol: (Array.isArray(item.symbols) ? item.symbols[0] : item.symbols)?.symbol ?? `#${item.symbol_id}` })))
      if ((data ?? []).length < 1000) break
    }
    return result
  } })
  const allRows = query.data ?? []
  const counts = Object.fromEntries(stages.map(value => [value, value === 'ALL' ? allRows.length : allRows.filter(item => item.evidence?.funnel_stage === value).length]))
  const rows = allRows.filter(item => (status === 'ALL' || item.action === status)
    && item.symbol.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))
    && (tab !== 'funnel' || stage === 'ALL' || item.evidence?.funnel_stage === stage)
    && (regime === 'ALL' || item.evidence?.market_regime === regime)
    && (monthly === 'ALL' || item.evidence?.monthly_state === monthly)
    && (weekly === 'ALL' || item.evidence?.weekly_setup === weekly)
    && (strategy === 'ALL' || item.strategy_code === strategy)
    && (oversold === 'ALL' || (oversold === 'YES') === Boolean(item.evidence?.oversold?.oversold))
    && (!maxDistance || item.evidence?.distance_to_stop_pct != null && item.evidence.distance_to_stop_pct <= Number(maxDistance))
    && (!reason || item.reasons.join(' ').toLocaleLowerCase('vi').includes(reason.trim().toLocaleLowerCase('vi'))))
    .sort((a, b) => Number(b.action !== 'WATCH') - Number(a.action !== 'WATCH') || a.symbol.localeCompare(b.symbol))
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  return <article className="panel challenger-research-panel">
    <div className="panel-title"><div><h3>{tab === 'funnel' ? 'Phễu MTF Challenger · tín hiệu riêng' : 'Phân kỳ MACD Challenger · Early Stage'}</h3>
      <small>{tab === 'funnel' ? 'Tháng UP/SIDEWAYS → setup tuần đã đóng → trigger ngày' : 'Đáy 2 tạm thời + MACD cắt lên Signal · Downtrend cần điều kiện quá bán'}</small></div><small>{date}</small></div>
    <p className="muted">Tín hiệu tính sau khi nến ngày đóng; điểm mua giả định sớm nhất là Open phiên sau. PROBE_BUY chỉ là tín hiệu nghiên cứu, không ghi lệnh vào danh mục.</p>
    {tab === 'funnel' && <div className="signal-funnel-counts" role="group" aria-label="Lọc giai đoạn phễu Challenger">{stages.map(value => <button type="button" key={value} className={stage === value ? 'selected' : ''} aria-pressed={stage === value} onClick={() => { setStage(value); setPage(1) }}>{value === 'ALL' ? 'Tất cả' : stageNames[value]} ({counts[value]})</button>)}</div>}
    <div className="challenger-research-controls"><label>Mã <input value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Tìm mã…" /></label>
      <label>Hành động <SoftSelect value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option>{values(allRows.map(item => item.action)).map(value => <option key={value} value={value}>{value}</option>)}</SoftSelect></label>
      <label>Regime <SoftSelect value={regime} onChange={event => { setRegime(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option>{values(allRows.map(item => item.evidence?.market_regime)).map(value => <option key={value} value={value}>{value}</option>)}</SoftSelect></label>
      {tab === 'funnel' ? <><label>Tháng <SoftSelect value={monthly} onChange={event => { setMonthly(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option>{values(allRows.map(item => item.evidence?.monthly_state)).map(value => <option key={value} value={value}>{value}</option>)}</SoftSelect></label>
        <label>Setup tuần <SoftSelect value={weekly} onChange={event => { setWeekly(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option>{values(allRows.map(item => item.evidence?.weekly_setup)).map(value => <option key={value} value={value}>{value}</option>)}</SoftSelect></label></>
        : <><label>Chiến lược <SoftSelect value={strategy} onChange={event => { setStrategy(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option>{codes.map(value => <option key={value} value={value}>{names[value]}</option>)}</SoftSelect></label>
          <label>Quá bán / BB dưới <SoftSelect value={oversold} onChange={event => { setOversold(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option><option value="YES">Có</option><option value="NO">Không</option></SoftSelect></label></>}
      <label>Xa stop tối đa % <input type="number" min="0" step="0.1" value={maxDistance} onChange={event => { setMaxDistance(event.target.value); setPage(1) }} placeholder="Bất kỳ" /></label>
      <label>Lý do <input value={reason} onChange={event => { setReason(event.target.value); setPage(1) }} placeholder="Mã lý do…" /></label>
      <button type="button" className="secondary-button" onClick={() => { setSearch(''); setStatus('ALL'); setStage('ALL'); setRegime('ALL'); setMonthly('ALL'); setWeekly('ALL'); setStrategy('ALL'); setOversold('ALL'); setMaxDistance(''); setReason(''); setPage(1) }}>Xóa bộ lọc</button>
      <span>{rows.length} kết quả · trang {current}/{pages}</span></div>
    {query.isLoading && <p>Đang tải tín hiệu riêng Challenger…</p>}
    {query.isError && <p className="form-error" role="alert">Không đọc được đánh giá chiến lược Challenger.</p>}
    {!query.isLoading && !query.isError && <><div className="challenger-research-grid">{rows.slice((current - 1) * pageSize, current * pageSize).map(item => {
      const info = item.evidence ?? {}
      const candidate = info.candidate ?? {}
      return <section className="challenger-research-row" key={`${item.symbol_id}-${item.strategy_code}`}>
        <header><strong>{item.symbol}</strong><span>{names[item.strategy_code]}</span><b className={`action-pill ${item.action.toLowerCase()}`}>{item.action}</b></header>
        <div className="challenger-research-facts"><span>Regime <b>{info.market_regime ?? '—'}</b></span>
          {item.strategy_code === 'ADAPTIVE_FUNNEL' ? <><span>Tháng <b>{info.monthly_state ?? '—'}</b></span><span>Tuần <b>{info.weekly_setup ?? '—'}</b></span><span>Giai đoạn <b>{info.funnel_stage ? stageNames[info.funnel_stage] ?? info.funnel_stage : '—'}</b></span></>
            : <><span>RSI14 <b>{number(info.oversold?.rsi14)}</b></span><span>Chạm BB dưới <b>{info.oversold?.lower_band_breach ? 'Có' : 'Không'}</b></span>
              <span>Đáy 1 / đáy 2 <b>{String(candidate.first_low_date ?? '—')} / {String(candidate.second_low_date ?? '—')}</b></span></>}
          <span>Nền <b>{number(item.base_price)}</b></span><span>Stop <b>{number(item.invalidation_price)}</b></span><span>Xa stop <b>{info.distance_to_stop_pct == null ? '—' : `${number(info.distance_to_stop_pct)}%`}</b></span>
          {info.order_participation_rate != null && <span>Tham gia lệnh <b>{number(info.order_participation_rate * 100)}%</b></span>}
          <span>Quy mô <b>{number((info.size_multiplier ?? 1) * 100)}% lệnh chuẩn</b></span>
          {info.max_portfolio_exposure_pct_downtrend != null && <span>Trần nghiên cứu downtrend <b>{info.max_portfolio_exposure_pct_downtrend}% NAV</b></span>}</div>
        <p>{item.reasons.map(reason => reasonNames[reason] ?? reason.replaceAll('_', ' ')).join(' · ')}</p>
        {candidate.target != null && <small>Mục tiêu nghiên cứu: {String(candidate.target)}; chỉ đánh giá sau thời điểm hàng được bán T+2.</small>}
      </section>
    })}</div><ResearchPagination label={`Phân trang ${tab === 'funnel' ? 'phễu' : 'phân kỳ MACD'} Challenger`} page={current} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1) }}/>
      {!rows.length && <p className={query.data?.length ? 'muted' : 'form-error'} role={query.data?.length ? undefined : 'alert'}>{query.data?.length ? 'Không có đánh giá khớp bộ lọc hiện tại.' : `Phiên ${date} chưa có assessment Challenger cho tab này trong database.`}</p>}</>}
  </article>
}
