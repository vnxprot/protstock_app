import { formatVnd } from '../lib/marketUnits'
import { formatDate } from '../lib/date'
import './portfolio-positions-table.css'

type Holding={id:string;symbol_id:string;quantity:number;averageCost:number;marketPrice:number|null;priceDate:string|null;pendingEntitlement:boolean;staleQuote:boolean;marketValue:number;profitLoss:number;returnPct:number|null;symbols:{symbol:string;sector:string|null}|null}
export function PortfolioPositionsTable({positions,netAssetValue,provisional,quoteError,onRetryQuotes,lotStates,onTrade}:{positions:Holding[];netAssetValue:number|null;provisional:boolean;quoteError:boolean;onRetryQuotes:()=>void;lotStates:Map<number,string[]>;onTrade:(action:'BUY_ADD'|'SELL_REDUCE'|'SELL_CLOSE',symbol?:string)=>void}) {
  return <>{quoteError&&<p className="form-error" role="status">Không tải được giá EOD. <button className="text-button" onClick={onRetryQuotes}>Thử lại</button></p>}<div className="portfolio-holdings-scroll"><table className="portfolio-holdings-table">
    <caption className="sr-only">Cơ cấu danh mục · Giá và giá trị bằng VND, khối lượng bằng cổ phiếu.</caption>
    <thead><tr><th scope="col">Mã</th><th scope="col" className="numeric">Khối lượng</th><th scope="col" className="numeric">Giá vốn</th><th scope="col" className="numeric">Giá thị trường</th><th scope="col" className="numeric">Giá trị thị trường</th><th scope="col" className="numeric">Lãi / lỗ</th><th scope="col" className="numeric">Tỷ trọng</th><th scope="col">Giao dịch</th></tr></thead>
    <tbody>{positions.map(item=><tr key={item.id}>
      <th scope="row"><strong>{item.symbols?.symbol??'—'}</strong><small>{item.symbols?.sector}</small><small>{lotStates.get(Number(item.symbol_id))?.join(' · ')??'Tuổi lô chưa có dữ liệu'}</small></th>
      <td className="numeric">{item.quantity.toLocaleString('vi-VN')} CP</td><td className="numeric">{formatVnd(item.averageCost)}</td>
      <td className="numeric">{formatVnd(item.marketPrice)}<small>{item.priceDate?`EOD ${formatDate(item.priceDate)}`:'Chưa có giá hợp lệ'}{item.staleQuote?' · Chưa cập nhật':''}</small></td><td className="numeric">{item.marketPrice==null?'—':formatVnd(item.marketValue)}{item.marketPrice!=null&&(item.pendingEntitlement||item.staleQuote)&&<small>Tạm tính{item.pendingEntitlement?' · Chờ đối soát quyền':''}</small>}</td>
      <td className={`numeric ${item.marketPrice==null?'':item.profitLoss<0?'negative':'positive'}`}>{item.marketPrice==null?'—':`${item.profitLoss>=0?'+':''}${formatVnd(item.profitLoss)}`}<small>{item.marketPrice==null||item.returnPct==null?'':`${item.returnPct>=0?'+':''}${item.returnPct.toFixed(2)}%`}</small>{item.marketPrice!=null&&(item.pendingEntitlement||item.staleQuote)&&<small>Tạm tính</small>}</td>
      <td className="numeric">{item.marketPrice==null||netAssetValue==null||netAssetValue<=0?'—':`${(item.marketValue/netAssetValue*100).toFixed(1)}%`}{netAssetValue!=null&&netAssetValue>0&&provisional&&<small>Tạm tính</small>}</td>
      <td><div className="portfolio-holdings-actions"><button type="button" className="secondary-button" onClick={()=>onTrade('BUY_ADD',item.symbols?.symbol)}>Mua thêm</button><button type="button" className="secondary-button" onClick={()=>onTrade('SELL_REDUCE',item.symbols?.symbol)}>Bán</button><button type="button" className="secondary-button" onClick={()=>onTrade('SELL_CLOSE',item.symbols?.symbol)}>Đóng</button></div></td>
    </tr>)}</tbody>
  </table></div><p className="muted">Tỷ trọng = giá trị thị trường / tổng tài sản gồm tiền mặt. {netAssetValue==null?'Chưa đủ giá hoặc số dư tiền mặt để tính tỷ trọng cho toàn danh mục.':provisional?'Tỷ trọng tạm tính theo số lượng và tiền mặt đang ghi nhận; NAV và hiệu suất vẫn chờ xác minh.':''}</p></>
}
