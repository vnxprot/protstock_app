import { ArrowUpRight, Star } from 'lucide-react'
import { investmentColumnValue, type InvestmentColumn, type InvestmentItem } from '../lib/investmentFilters'
import { toggleWatchlistSymbol } from '../lib/watchlist'

export function InvestmentMobileCards({ items, isGrowth, watched, onOpen }: { items: InvestmentItem[]; isGrowth: boolean; watched: string[]; onOpen: (id: number) => void }) {
  return <div className="investment-mobile-cards">{items.map(item => {
    const value = (column: InvestmentColumn) => investmentColumnValue(item, column, watched).label
    const state = item.fresh ? item.row?.evidence.cycle.state.toLowerCase() : 'unknown'
    return <article className="investment-mobile-card" key={item.stock.id}>
      <header><div><button type="button" className="investment-symbol" onClick={() => onOpen(item.stock.id)}>{item.stock.symbol}<ArrowUpRight size={14}/></button><small>{item.stock.sector} · {item.stock.exchange}</small></div><span className={'investment-stage ' + (isGrowth ? '' : state)}>{value(isGrowth ? 'setup' : 'stage')}</span><button type="button" className="investment-card-watch" aria-label={`${watched.includes(item.stock.symbol) ? 'Bỏ theo dõi' : 'Theo dõi'} ${item.stock.symbol}`} aria-pressed={watched.includes(item.stock.symbol)} onClick={() => toggleWatchlistSymbol(item.stock.symbol)}><Star size={17} fill={watched.includes(item.stock.symbol) ? 'currentColor' : 'none'}/></button></header>
      {isGrowth ? <dl><div><dt>RS Prot</dt><dd>{value('rs')}</dd></div><div><dt>Đến pivot</dt><dd>{value('pivot')}</dd></div><div><dt>TV20</dt><dd>{value('liquidity')}</dd></div></dl> : <><p>{value('evidence')}{value('event') !== '—' ? ` · ${value('event')}` : ''}</p><dl><div><dt>Tuần đóng</dt><dd>{value('weekly')}</dd></div><div><dt>TV20</dt><dd>{value('liquidity')}</dd></div></dl></>}
      <button type="button" className="investment-card-detail" onClick={() => onOpen(item.stock.id)}>{isGrowth ? 'Bảng kiểm và chi tiết' : 'Xem bằng chứng'}<ArrowUpRight size={14}/></button>
    </article>
  })}</div>
}
