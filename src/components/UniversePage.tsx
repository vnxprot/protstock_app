import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Filter, Search } from 'lucide-react'
import { SoftSelect } from './SoftSelect'
import { supabase } from '../lib/supabase'
import { downloadUniverseExcel, type StockUniverseExportRow } from '../lib/stock-universe-export'

const statusLabels: Record<string, string> = {
  NORMAL: 'Bình thường', RESTRICTED: 'Hạn chế giao dịch',
  SUSPENDED: 'Ngừng giao dịch', DELISTED: 'Huỷ niêm yết', UNKNOWN: 'Chưa xác minh',
}

export function UniversePage({ authenticated }: { authenticated: boolean }) {
  const symbols = useQuery({
    queryKey: ['universe-symbols'], enabled: authenticated && Boolean(supabase), staleTime: 300_000,
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured')
      const { data, error } = await supabase.from('symbols').select('id,symbol,company_name,sector,exchange,trading_status').eq('active', true).order('symbol')
      if (error) throw error
      return data ?? []
    },
  })
  const initial = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState(initial.get('sector') ?? '')
  const [exchange, setExchange] = useState(initial.get('exchange') ?? '')
  const [status, setStatus] = useState('')
  const universe = useMemo<StockUniverseExportRow[]>(() => (symbols.data ?? []).map(item => ({ index: 0, symbol: String(item.symbol ?? ''), companyName: item.company_name || 'Chưa cập nhật', sector: item.sector || 'Chưa phân ngành', exchange: item.exchange === 'HOSE' ? 'HSX' : item.exchange || 'Chưa cập nhật', tradingStatus: statusLabels[item.trading_status] ?? statusLabels.UNKNOWN })).sort((a, b) => a.symbol.localeCompare(b.symbol, 'en')).map((item, index) => ({ ...item, index: index + 1 })), [symbols.data])
  const sectors = [...new Set(universe.map(item => item.sector))].sort((a,b) => a.localeCompare(b, 'vi'))
  const exchanges = [...new Set(universe.map(item => item.exchange))].sort((a,b) => a.localeCompare(b, 'vi'))
  const statuses = [...new Set(universe.map(item => item.tradingStatus))].sort((a,b) => a.localeCompare(b, 'vi'))
  const filtered = universe.filter(item => (!sector || item.sector === sector) && (!exchange || item.exchange === (exchange === 'HOSE' ? 'HSX' : exchange)) && (!status || item.tradingStatus === status) && (!query.trim() || `${item.symbol} ${item.companyName} ${item.sector}`.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi'))))
  return <section className="workspace-page universe-page">
    <header className="universe-page-heading"><div><a href="#market">← Thị trường</a><h1>Danh sách cổ phiếu</h1><p>Universe Prot đang hoạt động; ô tình trạng chưa có dữ liệu hiển thị “Chưa xác minh”.</p></div><button type="button" className="primary-button universe-download-button" onClick={() => downloadUniverseExcel(filtered)} disabled={!filtered.length}><Download size={16}/> Tải danh sách</button></header>
    <article className="panel universe-list-panel"><div className="panel-title"><h3>{symbols.isLoading ? 'Đang tải danh sách…' : `${filtered.length}/${universe.length} mã cổ phiếu`}</h3><span>DANH SÁCH</span></div>
      <div className="universe-filters"><label><Search size={15}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm mã hoặc tên công ty" aria-label="Tìm cổ phiếu"/></label><label><Filter size={15}/><SoftSelect aria-label="Lọc theo nhóm ngành" value={sector} onChange={event => setSector(event.target.value)}><option value="">Tất cả nhóm ngành</option>{sectors.map(item => <option key={item} value={item}>{item}</option>)}</SoftSelect></label><label><Filter size={15}/><SoftSelect aria-label="Lọc theo sàn" value={exchange === 'HOSE' ? 'HSX' : exchange} onChange={event => setExchange(event.target.value)}><option value="">Tất cả sàn</option>{exchanges.map(item => <option key={item} value={item}>{item}</option>)}</SoftSelect></label><label><Filter size={15}/><SoftSelect aria-label="Lọc theo tình trạng giao dịch" value={status} onChange={event => setStatus(event.target.value)}><option value="">Mọi tình trạng</option>{statuses.map(item => <option key={item} value={item}>{item}</option>)}</SoftSelect></label></div>
      {symbols.isError ? <p className="form-error">Không thể tải danh sách cổ phiếu. Thử lại sau.</p> : <div className="data-table universe-table"><div className="table-head"><span>STT</span><span>Mã</span><span>Tên công ty</span><span>Nhóm ngành</span><span>Sàn</span><span>Tình trạng</span></div><div className="universe-mobile-head" aria-hidden="true"><span>Mã</span><span>Công ty · ngành</span><span>Sàn · tình trạng</span></div>{filtered.map((stock,index) => <div className="position-row" key={stock.symbol}><span className="universe-index">{index + 1}</span><strong className="universe-symbol">{stock.symbol}</strong><span className="universe-company" title={stock.companyName}>{stock.companyName}</span><span className="universe-sector" title={stock.sector}>{stock.sector}</span><span className="universe-exchange">{stock.exchange}</span><span className={`universe-status ${stock.tradingStatus === 'Bình thường' ? 'universe-status-normal' : stock.tradingStatus === 'Chưa xác minh' ? 'universe-status-unknown' : 'universe-status-restricted'}`}>{stock.tradingStatus}</span></div>)}{!symbols.isLoading && !filtered.length && <p className="muted">Không có mã phù hợp bộ lọc.</p>}</div>}
    </article>
  </section>
}
