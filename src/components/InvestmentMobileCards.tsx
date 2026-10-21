import { ArrowUpRight, Star } from 'lucide-react'
import { investmentColumnValue, type InvestmentColumn, type InvestmentItem } from '../lib/investmentFilters'
import { toggleWatchlistSymbol } from '../lib/watchlist'
import { statusLabels } from '../lib/investmentModules'
import { formatDate } from '../lib/date'

export function InvestmentMobileCards({ items, isGrowth, watched, onOpen }: { items: InvestmentItem[]; isGrowth: boolean; watched: string[]; onOpen: (id: number) => void }) {
  return <div className="investment-mobile-cards">{items.map(item => {
    const value = (column: InvestmentColumn) => investmentColumnValue(item, column, watched).label
    const state = item.fresh ? item.row?.evidence.cycle.state.toLowerCase() : 'unknown'
    return <article className="investment-mobile-card" key={item.stock.id}>
      <header><div><button type="button" className="investment-symbol" onClick={() => onOpen(item.stock.id)}>{item.stock.symbol}<ArrowUpRight size={14}/></button></div><span className={'investment-stage ' + (isGrowth ? '' : state)}>{value(isGrowth ? 'setup' : 'stage')}</span><button type="button" className="investment-card-watch" aria-label={`${watched.includes(item.stock.symbol) ? 'Bỏ theo dõi' : 'Theo dõi'} ${item.stock.symbol}`} aria-pressed={watched.includes(item.stock.symbol)} onClick={() => toggleWatchlistSymbol(item.stock.symbol)}><Star size={15} fill={watched.includes(item.stock.symbol) ? 'currentColor' : 'none'}/></button></header>
      <p className="investment-card-meta">{item.stock.company_name && <span>{item.stock.company_name} · </span>}{item.stock.sector || 'Chưa phân ngành'} · {item.stock.exchange === 'HOSE' ? 'HSX' : item.stock.exchange}<br/>Dữ liệu {formatDate(item.row?.as_of_date)}{!item.fresh ? ' · Chưa có dữ liệu cùng phiên' : ''}{item.stock.trading_status !== 'NORMAL' ? ` · ${item.stock.trading_status}` : ''}</p>
      {isGrowth && <ul className="investment-card-checks" aria-label="Bảy tiêu chí CANSLIM">{['C','A','N','S','L','I','M'].map(letter => { const status = item.checks[letter] ?? 'UNKNOWN'; return <li key={letter} className={status.toLowerCase()}><abbr title={`${letter}: ${statusLabels[status]}`} aria-label={`${letter}: ${statusLabels[status]}`}>{letter}<span aria-hidden="true">{status === 'PASS' ? '✓' : status === 'FAIL' ? '×' : status === 'STALE' ? '!' : '?'}</span></abbr></li> })}</ul>}
      {isGrowth ? <dl><div><dt>RS Prot</dt><dd>{value('rs')}</dd></div><div><dt>Đến pivot</dt><dd>{value('pivot')}</dd></div><div><dt>TV20</dt><dd>{value('liquidity')}</dd></div></dl> : <><p>{value('evidence')}{value('event') !== '—' ? ` · ${value('event')}` : ''}</p><dl><div><dt>Tuần đóng</dt><dd>{value('weekly')}</dd></div><div><dt>TV20</dt><dd>{value('liquidity')}</dd></div></dl></>}
      <button type="button" className="investment-card-detail" onClick={() => onOpen(item.stock.id)}>{isGrowth ? 'Bảng kiểm và chi tiết' : 'Xem bằng chứng'}<ArrowUpRight size={14}/></button>
    </article>
  })}</div>
}
