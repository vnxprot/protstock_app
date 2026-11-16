import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDate } from '../lib/date'
import { supabase } from '../lib/supabase'
import { SoftSelect } from './SoftSelect'
import './market-flow-radar.css'

const exchanges = [['all', 'Cả 3 sàn'], ['HOSE', 'HOSE'], ['HNX', 'HNX'], ['UPCOM', 'UPCoM']]
const groups = [
  ['price', 'Top cổ phiếu'], ['foreign', 'Khối ngoại'], ['proprietary', 'Tự doanh'],
  ['large', 'Khớp ≥ 1 tỷ'], ['medium', 'Khớp 200 triệu – dưới 1 tỷ'], ['small', 'Khớp dưới 200 triệu'],
]
const periods = [['1', '1 phiên'], ['5', '5 phiên'], ['20', '20 phiên'], ['50', '50 phiên'], ['200', '200 phiên'], ['ytd', 'Từ đầu năm']]
const priceOrders = [['up', 'Tăng mạnh'], ['down', 'Giảm mạnh'], ['volume', 'Khối lượng cao']]
const investorOrders = [['buy', 'Mua ròng'], ['sell', 'Bán ròng'], ['holdings', 'Số cổ phiếu sở hữu']]
const foreignOrders = [...investorOrders.filter(([id]) => id !== 'holdings'), ['ownership', 'Tỷ lệ sở hữu'], ['room', 'Room ngoại còn ít nhất']]
const tradeOrders = [['size', 'Giá trị khớp'], ['buy', 'Mua chủ động ròng'], ['sell', 'Bán chủ động ròng']]
const methods = [['total', 'Tổng giao dịch'], ['matched', 'Khớp lệnh'], ['negotiated', 'Thỏa thuận']]
const integer = new Intl.NumberFormat('vi-VN')
const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })

type FlowRow = {
  symbol: string; exchange: string; company_name: string | null; observed: number; source: string
  change_pct: number | null; last_close: number; volume: number
  buy_value: number | null; sell_value: number | null; net_value: number | null; net_volume: number | null
  total_value: number | null; unknown_value: number | null; trade_count: number | null; holdings: number | null
  ownership_pct: number | null; room_remaining: number | null; holdings_date: string | null; ownership_date: string | null
  room_date: string | null; avg_buy_price: number | null; liquidity_pct: number | null; net_sessions: number
  positive_sessions: number; partial: boolean
}
type Rank = { coverage: { exchange: string; latest: string; observed: number; partial: boolean }[]; rows: FlowRow[]; top_net: number | null }
type FlowDay = Pick<FlowRow, 'buy_value' | 'sell_value' | 'holdings' | 'source' | 'trade_count' | 'partial'> & { trading_date: string }

const shares = (value: number | null) => value == null ? '—' : integer.format(value)
const percent = (value: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${decimal.format(value)}%`
const billions = (value: number | null, signed = false) => value == null ? '—' : `${signed && value > 0 ? '+' : ''}${decimal.format(value / 1e9)}`
const dayLabel = (value: string | null) => value ? formatDate(value) : '—'
const orderOptions = (category: string) => category === 'price' ? priceOrders : category === 'foreign' ? foreignOrders : category === 'proprietary' ? investorOrders : tradeOrders

function RadarSelect({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <label>{label}<SoftSelect value={value} onChange={event => onChange(event.target.value)}>
    {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </SoftSelect></label>
}

export function MarketFlowRadar({ authenticated, tradingDates }: { authenticated: boolean; tradingDates: string[] }) {
  const [exchange, setExchange] = useState('all')
  const [category, setCategory] = useState('price')
  const [period, setPeriod] = useState('1')
  const [order, setOrder] = useState('up')
  const [method, setMethod] = useState('total')
  const [anchor, setAnchor] = useState('')
  const [focused, setFocused] = useState('')
  const price = category === 'price'
  const investor = category === 'foreign' || category === 'proprietary'
  const sized = !price && !investor
  const selectedMethod = sized ? 'continuous' : method
  const eligible = anchor ? tradingDates.filter(day => day <= anchor) : tradingDates
  const last = eligible.at(-1) ?? ''
  const dates = period === 'ytd' ? eligible.filter(day => day.startsWith(last.slice(0, 4))).slice(-260) : eligible.slice(-Number(period))
  const first = dates[0] ?? ''
  const expected = period === 'ytd' ? dates.length : Number(period)
  const ready = authenticated && Boolean(supabase && dates.length)
  const query = useQuery({
    queryKey: ['market-flow-radar', dates, exchange, category, selectedMethod, order], enabled: ready, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc('market_radar_rank', { p_dates: dates, p_exchange: exchange, p_category: category, p_method: selectedMethod, p_order: order })
      if (error) throw error
      return data as Rank
    },
  })
  const focus = query.data?.rows.find(row => `${row.exchange}:${row.symbol}` === focused)
  const details = useQuery({
    queryKey: ['market-flow-radar-detail', first, last, focused, category, selectedMethod], enabled: ready && !price && Boolean(focus), staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('market_radar_daily').select('trading_date,buy_value,sell_value,holdings,source,trade_count,partial')
        .eq('exchange', focus!.exchange).eq('symbol', focus!.symbol).eq('category', category).eq('method', selectedMethod)
        .gte('trading_date', first).lte('trading_date', last).order('trading_date', { ascending: false })
      if (error) throw error
      return data as FlowDay[]
    },
  })
  const scope = exchanges.filter(([id]) => id !== 'all' && (exchange === 'all' || exchange === id))
  const rows = query.data?.rows ?? []
  const showHolding = investor && (category === 'foreign' || order === 'holdings')
  const showLiquidity = sized || rows.some(row => row.liquidity_pct != null)

  return <section className="panel market-radar" aria-labelledby="market-radar-title">
    <div className="market-section-head"><div><h2 id="market-radar-title">Radar dòng tiền</h2><p>Dữ liệu cuối ngày · HOSE, HNX và UPCoM</p></div></div>
    <div className="market-radar-filters market-calendar-selects">
      <RadarSelect label="Nhóm" value={category} options={groups} onChange={value => { setCategory(value); setOrder(orderOptions(value)[0][0]); setFocused('') }}/>
      <RadarSelect label="Sàn" value={exchange} options={exchanges} onChange={setExchange}/>
      <RadarSelect label="Chu kỳ" value={period} options={periods} onChange={setPeriod}/>
      <label>Phiên cuối<input type="date" value={anchor || last} min={tradingDates[0]} max={tradingDates.at(-1)} onChange={event => setAnchor(event.target.value)}/></label>
      <RadarSelect label="Xếp hạng" value={order} options={orderOptions(category)} onChange={setOrder}/>
      {investor && <RadarSelect label="Phương thức" value={method} options={methods} onChange={setMethod}/>}
      {anchor && <button type="button" className="secondary-button" onClick={() => setAnchor('')}>Phiên mới nhất</button>}
    </div>
    {last && <p className="market-calendar-meta">{first === last ? dayLabel(last) : `${dayLabel(first)} – ${dayLabel(last)}`}{price ? ' · Mã đang theo dõi trong Prot Universe' : sized ? ' · Khớp lệnh liên tục của Prot Universe, phân theo giá trị từng lần khớp' : ' · Số sở hữu và room theo ngày ghi nhận'}</p>}
    {query.data && <div className="market-radar-coverage" aria-label="Độ phủ theo sàn">{scope.map(([id, name]) => {
      const item = query.data.coverage.find(entry => entry.exchange === id)
      return <span key={id}><strong>{name}</strong> {item?.observed ?? 0}/{expected} phiên{item ? ` · Đến ${dayLabel(item.latest)}${item.partial ? ' · Có mẫu giới hạn' : ''}` : ' · Chưa có dữ liệu'}</span>
    })}</div>}
    {sized && <p className="market-calendar-meta">Mua/bán chủ động dùng chiều do nguồn cung cấp. Giá trị khớp có thể gồm giao dịch chưa rõ chiều. Quy mô lần khớp không xác định chủ tài khoản.</p>}
    {query.isFetching && <p className="market-calendar-meta" role="status">Đang tải xếp hạng…</p>}
    {query.isError && <p className="market-error" role="alert">Không tải được radar. Hãy thử lại. <button type="button" className="secondary-button" onClick={() => void query.refetch()}>Tải lại</button></p>}
    {!query.isFetching && !query.isError && rows.length === 0 && <p className="market-empty">{query.data?.coverage.length ? 'Chưa có mã phù hợp với cách xếp hạng này.' : 'Chưa đủ dữ liệu cho lựa chọn này.'}</p>}
    {rows.length > 0 && <>
      <h3>Top {rows.length} {orderOptions(category).find(([id]) => id === order)?.[1].toLowerCase()}</h3>
      {!price && query.data?.top_net != null && <p className="market-calendar-meta">Tổng ròng Top {rows.length} <strong>{billions(query.data.top_net, true)} tỷ</strong></p>}
      <div className="market-table-scroll" tabIndex={0} aria-label="Bảng xếp hạng radar">
        <table className="market-radar-table"><thead><tr><th scope="col">Mã / Sàn</th>
          {price ? <><th scope="col">Biến động</th><th scope="col">Đóng cửa (đ)</th><th scope="col">Khối lượng (CP)</th></> : <>
            <th scope="col">Mua (tỷ)</th><th scope="col">Bán (tỷ)</th><th scope="col">Ròng (tỷ)</th><th scope="col">KL ròng (CP)</th>
            {sized && <><th scope="col">Giá trị khớp (tỷ)</th><th scope="col">Chưa rõ chiều (tỷ)</th><th scope="col">Lần khớp</th></>}
            <th scope="col">Phiên ròng dương</th>{showLiquidity && <th scope="col">Ròng / thanh khoản</th>}
            {showHolding && <th scope="col">Sở hữu (CP)</th>}{category === 'foreign' && <><th scope="col">Sở hữu (%)</th><th scope="col">Room còn (CP)</th></>}
          </>}<th scope="col">Phiên có dữ liệu</th></tr></thead>
          <tbody>{rows.map(row => {
            const key = `${row.exchange}:${row.symbol}`
            return <tr key={key}><th scope="row">{price ? <a href="#analysis" onClick={() => localStorage.setItem('protstock-symbol', row.symbol)}>{row.symbol}</a> : <button type="button" aria-expanded={focused === key} onClick={() => setFocused(focused === key ? '' : key)}>{row.symbol}</button>} <small>{row.exchange === 'UPCOM' ? 'UPCoM' : row.exchange}</small>{row.company_name && <small className="radar-company">{row.company_name}</small>}</th>
              {price ? <><td>{percent(row.change_pct)}</td><td>{shares(row.last_close)}</td><td>{shares(row.volume)}</td></> : <>
                <td>{billions(row.buy_value)}</td><td>{billions(row.sell_value)}</td><td data-direction={Math.sign(row.net_value ?? 0)}>{billions(row.net_value, true)}</td><td>{shares(row.net_volume)}</td>
                {sized && <><td>{billions(row.total_value)}</td><td>{billions(row.unknown_value)}</td><td>{shares(row.trade_count)}</td></>}
                <td>{row.net_sessions ? `${row.positive_sessions}/${row.net_sessions}` : '—'}</td>{showLiquidity && <td>{percent(row.liquidity_pct)}</td>}
                {showHolding && <td>{shares(row.holdings)}{row.holdings_date && <small>{dayLabel(row.holdings_date)}</small>}</td>}
                {category === 'foreign' && <><td>{row.ownership_pct == null ? '—' : `${decimal.format(row.ownership_pct)}%`}{row.ownership_date && <small>{dayLabel(row.ownership_date)}</small>}</td><td>{shares(row.room_remaining)}{row.room_date && <small>{dayLabel(row.room_date)}</small>}</td></>}
              </>}<td title={row.source}>{row.observed}/{expected}{row.partial && <small>Mẫu giới hạn</small>}</td></tr>
          })}</tbody>
        </table>
      </div>
    </>}
    {focus && <section className="market-radar-detail" aria-label={`Chi tiết ${focus.symbol}`}>
      <h3>{focus.symbol} · Giao dịch từng phiên</h3>
      <p className="market-calendar-meta">Nguồn {focus.source}{focus.avg_buy_price != null && ` · Giá mua bình quân ${shares(focus.avg_buy_price)} đ/CP`}</p>
      {details.isFetching && <p role="status">Đang tải chi tiết…</p>}
      {details.isError && <p role="alert">Không tải được chi tiết mã.</p>}
      {Boolean(details.data?.length) && <div className="market-table-scroll" tabIndex={0} aria-label="Chi tiết từng phiên"><table className="market-radar-table">
        <thead><tr><th scope="col">Phiên</th><th scope="col">Mua (tỷ)</th><th scope="col">Bán (tỷ)</th><th scope="col">Ròng (tỷ)</th>{sized && <th scope="col">Lần khớp</th>}</tr></thead>
        <tbody>{details.data?.map(item => <tr key={item.trading_date}><th scope="row">{dayLabel(item.trading_date)}{item.partial && <small>Mẫu giới hạn</small>}</th><td>{billions(item.buy_value)}</td><td>{billions(item.sell_value)}</td><td>{billions(item.buy_value == null || item.sell_value == null ? null : item.buy_value - item.sell_value, true)}</td>{sized && <td>{shares(item.trade_count)}</td>}</tr>)}</tbody>
      </table></div>}
    </section>}
  </section>
}
