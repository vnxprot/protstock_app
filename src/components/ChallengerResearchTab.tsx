import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import './ChallengerResearchTab.css'

type Code = 'ADAPTIVE_FUNNEL' | 'MACD_EARLY_ZONE' | 'DOWNTREND_SPRING'
type Evidence = {
  market_regime?: string; price_basis?: string; size_multiplier?: number; funnel_stage?: string
  monthly_state?: string; weekly_setup?: string | null; setup_id?: string | null
  stage?: string; oversold?: { rsi14?: number | null; lower_band_breach?: boolean }
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

export function ChallengerResearchTab({ date, tab }: { date: string; tab: 'funnel' | 'macd' }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
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
  const rows = (query.data ?? []).filter(item => (status === 'ALL' || item.action === status)
    && item.symbol.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')))
    .sort((a, b) => Number(b.action !== 'WATCH') - Number(a.action !== 'WATCH') || a.symbol.localeCompare(b.symbol))
  const pages = Math.max(1, Math.ceil(rows.length / 25))
  const current = Math.min(page, pages)
  return <article className="panel challenger-research-panel">
    <div className="panel-title"><div><h3>{tab === 'funnel' ? 'Phễu MTF Challenger · tín hiệu riêng' : 'Phân kỳ MACD Challenger · Early Stage'}</h3>
      <small>{tab === 'funnel' ? 'Monthly UP/SIDEWAYS → Weekly Context → Daily Setup → Daily Trigger' : 'Đáy 2 tạm thời + MACD cắt lên Signal · Downtrend cần điều kiện quá bán'}</small></div><small>{date}</small></div>
    <p className="muted">Tín hiệu tính sau khi nến ngày đóng; điểm mua giả định sớm nhất là Open phiên sau. PROBE_BUY chỉ là tín hiệu nghiên cứu, không ghi lệnh vào danh mục.</p>
    <div className="challenger-research-controls"><label>Mã <input value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Tìm mã…" /></label>
      <label>Hành động <select value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}><option value="ALL">Tất cả</option><option value="PROBE_BUY">Thăm dò</option><option value="EARLY_PROBE">Vào sớm</option><option value="WATCH">Theo dõi</option></select></label>
      <span>{rows.length} kết quả · trang {current}/{pages}</span></div>
    {query.isLoading && <p>Đang tải tín hiệu riêng Challenger…</p>}
    {query.isError && <p className="form-error" role="alert">Không đọc được đánh giá chiến lược Challenger.</p>}
    {!query.isLoading && !query.isError && <><div className="challenger-research-grid">{rows.slice((current - 1) * 25, current * 25).map(item => {
      const info = item.evidence ?? {}
      const candidate = info.candidate ?? {}
      return <section className="challenger-research-row" key={`${item.symbol_id}-${item.strategy_code}`}>
        <header><strong>{item.symbol}</strong><span>{names[item.strategy_code]}</span><b className={`action-pill ${item.action.toLowerCase()}`}>{item.action}</b></header>
        <div className="challenger-research-facts"><span>Regime <b>{info.market_regime ?? '—'}</b></span>
          {item.strategy_code === 'ADAPTIVE_FUNNEL' ? <><span>Tháng <b>{info.monthly_state ?? '—'}</b></span><span>Tuần <b>{info.weekly_setup ?? '—'}</b></span><span>Giai đoạn <b>{info.funnel_stage ?? '—'}</b></span></>
            : <><span>RSI14 <b>{number(info.oversold?.rsi14)}</b></span><span>Chạm BB dưới <b>{info.oversold?.lower_band_breach ? 'Có' : 'Không'}</b></span>
              <span>Đáy 1 / đáy 2 <b>{String(candidate.first_low_date ?? '—')} / {String(candidate.second_low_date ?? '—')}</b></span></>}
          <span>Stop <b>{number(item.invalidation_price)}</b></span><span>Xa stop <b>{number(info.distance_to_stop_pct)}%</b></span>
          <span>Quy mô <b>{number((info.size_multiplier ?? 1) * 100)}% lệnh chuẩn</b></span>
          {info.max_portfolio_exposure_pct_downtrend != null && <span>Trần nghiên cứu downtrend <b>{info.max_portfolio_exposure_pct_downtrend}% NAV</b></span>}</div>
        <p>{item.reasons.map(reason => reasonNames[reason] ?? reason.replaceAll('_', ' ')).join(' · ')}</p>
        {candidate.target != null && <small>Mục tiêu nghiên cứu: {String(candidate.target)}; chỉ đánh giá sau thời điểm hàng được bán T+2.</small>}
      </section>
    })}</div><nav className="dual-engine-pages"><button disabled={current <= 1} onClick={() => setPage(current - 1)}>‹ Trước</button><button disabled={current >= pages} onClick={() => setPage(current + 1)}>Sau ›</button></nav>
      {!rows.length && <p className={query.data?.length ? 'muted' : 'form-error'} role={query.data?.length ? undefined : 'alert'}>{query.data?.length ? 'Không có đánh giá khớp bộ lọc hiện tại.' : `Phiên ${date} chưa có assessment Challenger cho tab này trong database.`}</p>}</>}
  </article>
}
