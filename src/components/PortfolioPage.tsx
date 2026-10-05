import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, FileText, Plus, WalletCards, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SoftSelect } from './SoftSelect'
import { SymbolAutocomplete } from './SymbolAutocomplete'
import { CurrencyInput } from './CurrencyInput'
import { QuantityInput } from './QuantityInput'
import { DateField } from './DateField'
import { PortfolioTransactions, type PortfolioTransaction } from './PortfolioTransactions'
import { useSymbols } from '../hooks/useStockAnalysis'
import { formatVnd } from '../lib/marketUnits'
import { useAccountId } from '../hooks/useAccountId'
import { todayInVietnam } from '../lib/date'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { portfolioTimeline, type LedgerReport } from '../lib/portfolioLedger'
import { downloadPortfolioExcel, downloadPortfolioPdf, type PortfolioReportData } from '../lib/portfolioReports'
import { unsettledLotStates } from '../lib/signalTriage'

const transactionLabels = { BUY_NEW: 'Mua mới', BUY_ADD: 'Mua thêm', SELL_REDUCE: 'Bán giảm', SELL_CLOSE: 'Đóng vị thế', STOP_UPDATE: 'Điều chỉnh stop' } as const
type TransactionAction = keyof typeof transactionLabels
type PricePoint = { symbol_id: string; trading_date: string; close: number }
type Position = { id: string; symbol_id: string; quantity: number; average_cost: number; stop_price: number | null; opened_at: string; thesis: string | null; symbols: { symbol: string; sector: string | null } | null }
const money = (value: number) => formatVnd(value)

function ReturnChart({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) return <p className="muted">Cần ít nhất 2 phiên giá để vẽ tỷ suất lợi nhuận.</p>
  const values = points.map(item => item.value)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || 1
  const polyline = points.map((item, index) => `${(index / (points.length - 1)) * 100},${92 - ((item.value - min) / span) * 84}`).join(' ')
  return <div className="portfolio-return-chart"><div><b className={values.at(-1)! < 0 ? 'negative' : 'positive'}>{values.at(-1)! >= 0 ? '+' : ''}{values.at(-1)!.toFixed(2)}%</b><small>Tỷ suất sau loại trừ nộp/rút vốn</small></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Biểu đồ tỷ suất lợi nhuận"><line x1="0" x2="100" y1={92 - ((0 - min) / span) * 84} y2={92 - ((0 - min) / span) * 84}/><polyline points={polyline}/></svg><footer><span>{points[0].date.split('-').reverse().join('/')}</span><span>{points.at(-1)!.date.split('-').reverse().join('/')}</span></footer></div>
}

export function PortfolioPage({ authenticated }: { authenticated: boolean }) {
  const client = useQueryClient()
  const userId = useAccountId(authenticated)
  const symbols = useSymbols(authenticated)
  const [setupOpen, setSetupOpen] = useState(false)
  const [tradeOpen, setTradeOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [initialCapital, setInitialCapital] = useState(100_000_000)
  const [capitalMode, setCapitalMode] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT')
  const [capitalAmount, setCapitalAmount] = useState(0)
  const [capitalDate, setCapitalDate] = useState(todayInVietnam())
  const [capitalNote, setCapitalNote] = useState('')
  const [maxRisk, setMaxRisk] = useState(1)
  const [symbol, setSymbol] = useState('')
  const [action, setAction] = useState<TransactionAction>('BUY_NEW')
  const [quantity, setQuantity] = useState(100)
  const [price, setPrice] = useState(0)
  const [stop, setStop] = useState(0)
  const [note, setNote] = useState('')
  const [tradingDate, setTradingDate] = useState(todayInVietnam())
  const [editingTransaction, setEditingTransaction] = useState<PortfolioTransaction | null>(null)
  const [hoveredSector, setHoveredSector] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const requestId = useRef(crypto.randomUUID())
  const setupRef = useRef<HTMLFormElement>(null)
  const tradeRef = useRef<HTMLFormElement>(null)
  const closeSetup = useCallback(() => { if (!submitLock.current) setSetupOpen(false) }, [])
  const closeTrade = useCallback(() => { if (!submitLock.current) setTradeOpen(false) }, [])
  useDialogFocus(setupOpen, setupRef, closeSetup)
  useDialogFocus(tradeOpen, tradeRef, closeTrade)

  const portfolio = useQuery({
    queryKey: ['portfolio', userId], enabled: Boolean(userId) && Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!.from('portfolios').select('id,name,capital,max_risk_per_trade_pct,created_at,positions(id,symbol_id,quantity,average_cost,stop_price,opened_at,thesis,symbols(symbol,sector))').eq('user_id', userId!).order('created_at', { ascending: true }).limit(1).maybeSingle()
      if (error) throw error
      return data
    },
  })
  const positions = ((portfolio.data?.positions ?? []) as unknown as Position[]).map(item => ({ ...item, symbols: Array.isArray(item.symbols) ? item.symbols[0] ?? null : item.symbols }))
  const positionIds = positions.map(item => item.symbol_id)
  const selectedPosition = positions.find(item => item.symbols?.symbol === symbol) ?? null
  const report = useQuery({
    queryKey: ['portfolio-report', userId, portfolio.data?.id], enabled: Boolean(userId && supabase && portfolio.data?.id),
    queryFn: async () => {
      const { data, error } = await supabase!.rpc('portfolio_report_data', { p_portfolio_id: portfolio.data!.id, p_as_of_date: todayInVietnam() })
      if (error) throw error
      return data as LedgerReport
    },
  })
  const timeline = useMemo(() => report.data ? portfolioTimeline(report.data) : [], [report.data])
  const latestLedger = timeline.at(-1)
  const transactions = { data: report.data?.transactions }
  const capitalMovements = { data: report.data?.capital_movements }
  const prices = { data: report.data?.prices as PricePoint[] | undefined }

  const managed = latestLedger?.capital ?? Number(portfolio.data?.capital ?? 0)
  const priceBySymbol = useMemo(() => {
    const grouped: Record<string, PricePoint[]> = {}
    ;(prices.data ?? []).forEach(item => (grouped[item.symbol_id] ??= []).push(item))
    return Object.fromEntries(Object.entries(grouped).map(([id, rows]) => [id, rows.sort((a, b) => b.trading_date.localeCompare(a.trading_date))]))
  }, [prices.data])
  const positionMetrics = useMemo(() => positions.map(item => {
    const marketRows = priceBySymbol[item.symbol_id] ?? []
    const marketPrice = marketRows[0] ? Number(marketRows[0].close) * 1_000 : null
    const previousPrice = marketRows[1] ? Number(marketRows[1].close) * 1_000 : null
    const quantity = Number(item.quantity)
    const averageCost = Number(item.average_cost)
    const marketValue = quantity * (marketPrice ?? averageCost)
    const profitLoss = marketValue - quantity * averageCost
    return { ...item, quantity, averageCost, marketPrice, previousPrice, marketValue, profitLoss, returnPct: averageCost ? profitLoss / (quantity * averageCost) * 100 : null }
  }), [positions, priceBySymbol])
  const deployed = positionMetrics.reduce((sum, item) => sum + item.averageCost * item.quantity, 0)
  const marketValue = positionMetrics.reduce((sum, item) => sum + item.marketValue, 0)
  const buyFlow = (transactions.data ?? []).filter((item: any) => ['BUY_NEW', 'BUY_ADD'].includes(item.action)).reduce((sum: number, item: any) => sum + Number(item.quantity) * Number(item.price ?? 0), 0)
  const sellFlow = (transactions.data ?? []).filter((item: any) => ['SELL_REDUCE', 'SELL_CLOSE'].includes(item.action)).reduce((sum: number, item: any) => sum + Number(item.quantity) * Number(item.price ?? 0), 0)
  const cash = latestLedger?.cash ?? managed - (buyFlow || deployed) + sellFlow
  const holdingQuantity = Number(selectedPosition?.quantity ?? 0)
  const isBuyAction = ['BUY_NEW', 'BUY_ADD'].includes(action)
  const isSellAction = ['SELL_REDUCE', 'SELL_CLOSE', 'STOP_UPDATE'].includes(action)
  const availableBuyQuantity = price > 0 ? Math.floor(cash / price) : 0
  useEffect(() => {
    if (!tradeOpen || editingTransaction || action !== 'SELL_CLOSE' || holdingQuantity <= 0) return
    setQuantity(holdingQuantity)
  }, [tradeOpen, editingTransaction, action, holdingQuantity])
  const netAssetValue = cash + marketValue
  const profitLoss = managed ? netAssetValue - managed : 0
  const returnPct = latestLedger?.value ?? null
  const todayProfitLoss = timeline.length >= 2 && latestLedger ? latestLedger.nav - timeline[timeline.length - 2].nav - latestLedger.netFlow : null
  const yesterdayValue = timeline.length >= 2 ? timeline[timeline.length - 2].nav + (latestLedger?.netFlow ?? 0) : 0
  const todayReturnPct = todayProfitLoss == null || !yesterdayValue ? null : todayProfitLoss / yesterdayValue * 100
  const averageNetAssets = timeline.length ? timeline.reduce((sum, item) => sum + item.nav, 0) / timeline.length : null
  const deployedPct = managed ? deployed / managed * 100 : 0
  const sizing = useMemo(() => { const unitRisk = price - stop; return stop > 0 && unitRisk > 0 && managed > 0 ? Math.floor(Math.min(managed * Number(portfolio.data?.max_risk_per_trade_pct ?? 0) / 100 / unitRisk, availableBuyQuantity) / 100) * 100 : 0 }, [price, stop, managed, availableBuyQuantity, portfolio.data?.max_risk_per_trade_pct])
  const totalRisk = managed > 0 ? positionMetrics.reduce((sum, item) => sum + Math.max(0, ((item.marketPrice ?? item.averageCost) - Number(item.stop_price ?? item.marketPrice ?? item.averageCost)) * item.quantity), 0) / managed * 100 : 0
  const allocation = useMemo(() => {
    const grouped = positionMetrics.reduce((all: Record<string, number>, item) => { const sector = item.symbols?.sector || 'Khác'; all[sector] = (all[sector] || 0) + item.marketValue; return all }, {})
    const total = Object.values(grouped).reduce((sum, value) => sum + value, 0)
    const colors = ['#d7ff52', '#55e6b1', '#5d85ff', '#efbf62', '#c88cff']
    let cursor = 0
    return Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value], index) => { const start = cursor; const pct = total ? value / total * 100 : 0; cursor += pct; return { label, value, pct, capitalPct: managed ? value / managed * 100 : 0, color: colors[index], start, end: cursor } })
  }, [positionMetrics, managed])
  const returnHistory = timeline.slice(-60)
  const donut = allocation.length ? `conic-gradient(${allocation.map(item => `${item.color} ${item.start}% ${item.end}%`).join(',')})` : '#1b2c24'
  const concentration = allocation.find(item => item.capitalPct > 40)
  const hovered = allocation.find(item => item.label === hoveredSector)
  const latestDate = latestLedger?.date ?? null
  const settlementSessions = useQuery({ queryKey: ['portfolio-settlement-sessions', latestDate], enabled: Boolean(supabase && latestDate), queryFn: async () => {
    const { data, error } = await supabase!.from('market_breadth_snapshots').select('trading_date')
      .lte('trading_date', latestDate!).order('trading_date', { ascending: false }).limit(20)
    if (error) throw error
    return (data ?? []).map(row => row.trading_date)
  } })
  const lotStates = useMemo(() => latestDate && settlementSessions.data?.length
    ? unsettledLotStates((transactions.data ?? []).map(item => ({ ...item, symbol_id: Number(item.symbol_id) })), latestDate, settlementSessions.data)
    : new Map<number, string[]>(), [transactions.data, latestDate, settlementSessions.data])
  const reportData: PortfolioReportData = { methodology: 'Giá vốn bình quân gia quyền; chưa gồm phí/thuế. Tỷ suất loại trừ nộp/rút vốn đầu ngày.', missingPriceCount: latestLedger?.missingPrices ?? 0, asOfDate: latestDate, capital: managed, cash, marketValue, netAssetValue, profitLoss, returnPct, todayProfitLoss, todayReturnPct, averageNetAssets, positions: positionMetrics.map(item => ({ symbol: item.symbols?.symbol ?? '—', sector: item.symbols?.sector ?? 'Khác', quantity: item.quantity, averageCost: item.averageCost, marketPrice: item.marketPrice, marketValue: item.marketValue, profitLoss: item.profitLoss, returnPct: item.returnPct, weightPct: netAssetValue ? item.marketValue / netAssetValue * 100 : 0 })) }

  const notify = (message: string) => { setToast(message); setTimeout(() => setToast(''), 3_200) }
  async function exportReport(format: 'excel' | 'pdf') { if (!report.data || report.isError) return notify('Hãy tải đầy đủ dữ liệu danh mục trước khi xuất báo cáo'); try { if (format === 'excel') await downloadPortfolioExcel(reportData); else await downloadPortfolioPdf(reportData); setReportOpen(false) } catch { notify('Không thể tạo báo cáo. Thử lại sau.') } }
  const openTrade = (nextAction: TransactionAction = 'BUY_NEW', ticker = '', existing: PortfolioTransaction | null = null) => { requestId.current = crypto.randomUUID(); setEditingTransaction(existing); setAction(existing?.action as TransactionAction ?? nextAction); setSymbol(existing?.symbols?.symbol ?? ticker); setQuantity(existing?.quantity ?? 100); setPrice(Number(existing?.price ?? 0)); setStop(Number(existing?.stop_price ?? 0)); setNote(existing?.note ?? ''); setTradingDate(existing?.trading_date ?? todayInVietnam()); setTradeOpen(true) }
  const openCapitalSetup = () => { requestId.current = crypto.randomUUID(); setInitialCapital(managed || 100_000_000); setCapitalMode('DEPOSIT'); setCapitalAmount(0); setCapitalDate(todayInVietnam()); setCapitalNote(''); setMaxRisk(Number(portfolio.data?.max_risk_per_trade_pct ?? 1)); setSetupOpen(true) }
  async function createPortfolio(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !userId || submitLock.current) return
    if (capitalDate > todayInVietnam()) return notify('Ngày hạch toán không được ở tương lai')
    if (maxRisk <= 0 || maxRisk > 100) return notify('Rủi ro mỗi lệnh phải lớn hơn 0 và không quá 100%')
    submitLock.current = true; setSubmitting(true)
    try {
      if (!portfolio.data) {
        if (initialCapital <= 0) return notify('Vốn khởi tạo phải lớn hơn 0')
        const { error } = await supabase.from('portfolios').insert({ user_id: userId, name: 'Danh mục Prot', capital: initialCapital, max_risk_per_trade_pct: maxRisk })
        if (error) throw error
      } else {
        if (capitalAmount <= 0) return notify('Số tiền nộp hoặc rút phải lớn hơn 0')
        const { error } = await supabase.rpc('record_portfolio_capital_movement', { p_portfolio_id: portfolio.data.id, p_movement_type: capitalMode, p_amount: capitalAmount, p_effective_date: capitalDate, p_note: capitalNote || null, p_request_id: requestId.current })
        if (error) throw error
      }
      if (portfolio.data && maxRisk !== Number(portfolio.data.max_risk_per_trade_pct)) {
        const { error } = await supabase.from('portfolios').update({ max_risk_per_trade_pct: maxRisk }).eq('id', portfolio.data.id)
        if (error) throw error
      }
      await Promise.all([client.invalidateQueries({ queryKey: ['portfolio'] }), client.invalidateQueries({ queryKey: ['portfolio-report'] })])
      setSetupOpen(false); requestId.current = crypto.randomUUID(); notify('Đã lưu vốn và cập nhật sổ biến động')
    } catch { notify('Chưa lưu được vốn. Kiểm tra kết nối và thử lại; yêu cầu được giữ để tránh ghi trùng.') }
    finally { submitLock.current = false; setSubmitting(false) }
  }
  async function submitTransaction(event: FormEvent) {
    event.preventDefault()
    const symbolId = symbols.data?.find(item => item.symbol === symbol)?.id
    if (submitLock.current) return
    if (tradingDate > todayInVietnam()) return notify('Ngày giao dịch không được ở tương lai')
    if (action === 'STOP_UPDATE' && stop <= 0) return notify('Stop mới phải lớn hơn 0')
    if (!supabase || !portfolio.data || !symbolId) return notify('Hãy chọn mã từ gợi ý')
    if (isBuyAction && (price <= 0 || quantity <= 0 || quantity > availableBuyQuantity)) return notify('Khối lượng mua phải trong giới hạn sức mua còn lại')
    if (isSellAction && !selectedPosition && !editingTransaction) return notify('Mã này không có vị thế đang mở')
    if (action === 'SELL_REDUCE' && quantity > holdingQuantity) return notify('Khối lượng bán không được vượt số cổ phiếu đang nắm giữ')
    let savedAction = !editingTransaction && action === 'BUY_NEW' && selectedPosition ? 'BUY_ADD' : action
    const lockedQuantity = !editingTransaction && action === 'SELL_CLOSE' ? holdingQuantity : quantity
    const payload = (nextAction: TransactionAction) => ({ p_action: nextAction, p_quantity: nextAction === 'STOP_UPDATE' ? 0 : lockedQuantity, p_price: nextAction === 'STOP_UPDATE' ? null : price || null, p_stop_price: stop || null, p_note: note || null, p_trading_date: tradingDate })
    submitLock.current = true; setSubmitting(true)
    try {
    let result = editingTransaction
      ? await supabase.rpc('update_portfolio_transaction', { p_transaction_id: editingTransaction.id, ...payload(savedAction) })
      : await supabase.rpc('record_portfolio_transaction', { p_portfolio_id: portfolio.data.id, p_symbol_id: symbolId, p_request_id: requestId.current, ...payload(savedAction) })
    // The position query can be briefly stale after another device saves a trade.
    // Retry the only recoverable sequence error as BUY_ADD rather than losing the entry.
    if (!editingTransaction && savedAction === 'BUY_NEW' && result.error?.message.includes('Invalid BUY_NEW ledger sequence')) {
      savedAction = 'BUY_ADD'
      result = await supabase.rpc('record_portfolio_transaction', { p_portfolio_id: portfolio.data.id, p_symbol_id: symbolId, p_request_id: requestId.current, ...payload(savedAction) })
    }
    if (result.error) return notify(`Không thể lưu giao dịch: ${result.error.message}`)
    client.invalidateQueries({ queryKey: ['portfolio'] }); client.invalidateQueries({ queryKey: ['portfolio-transactions'] }); client.invalidateQueries({ queryKey: ['portfolio-report'] }); client.invalidateQueries({ queryKey: ['journal-portfolio-transactions'] }); client.invalidateQueries({ queryKey: ['journal'] }); setTradeOpen(false); notify(editingTransaction ? 'Đã cập nhật giao dịch và vị thế' : `${transactionLabels[savedAction]} đã lưu`); requestId.current = crypto.randomUUID()
    } catch { notify('Không thể lưu giao dịch. Kiểm tra kết nối và thử lại.') } finally { submitLock.current = false; setSubmitting(false) }
  }
  async function deleteTransaction(item: PortfolioTransaction) {
    if (!supabase || submitLock.current || !confirm('Xóa giao dịch '+(item.symbols?.symbol??'')+'? Vị thế sẽ được tính lại.')) return
    submitLock.current=true;setSubmitting(true)
    try {
      const {error}=await supabase.rpc('delete_portfolio_transaction',{p_transaction_id:item.id})
      if(error)throw error
      await Promise.all([client.invalidateQueries({queryKey:['portfolio']}),client.invalidateQueries({queryKey:['portfolio-report']}),client.invalidateQueries({queryKey:['journal-portfolio-transactions']})])
      notify('Đã xóa giao dịch và tính lại vị thế')
    }catch{notify('Chưa xóa được giao dịch. Kiểm tra kết nối và thử lại.')}
    finally{submitLock.current=false;setSubmitting(false)}
  }

  return <section className="workspace-page"><div className="page-title-row"><div><h1>Danh mục</h1><p className="muted">Giá: VND/cổ phiếu · Khối lượng: cổ phiếu · Dữ liệu giá gần nhất: {latestDate ? latestDate.split('-').reverse().join('/') : '—'}.</p></div><div className="page-actions portfolio-actions"><div className="report-menu"><button className="secondary-button" onClick={() => setReportOpen(value => !value)}><Download size={16}/> Báo cáo tổng quan <ChevronDown size={14}/></button>{reportOpen && <div className="report-menu-popover"><button onClick={() => void exportReport('excel')}><FileSpreadsheet size={16}/> Tải Excel <small>.xlsx · số liệu đầy đủ</small></button><button onClick={() => void exportReport('pdf')}><FileText size={16}/> Tải PDF <small>.pdf · bản tóm tắt</small></button></div>}</div>{portfolio.data && <button className="secondary-button" onClick={openCapitalSetup}>Nộp / rút vốn</button>}<button className="primary-button" onClick={() => portfolio.data ? openTrade() : openCapitalSetup()}><Plus size={16}/>{portfolio.data ? 'Giao dịch' : 'Khởi tạo danh mục'}</button></div></div>
    {portfolio.isLoading && <p role="status">Đang tải danh mục…</p>}
    {portfolio.isError && <p className="form-error" role="alert">Không tải được danh mục. <button type="button" onClick={() => void portfolio.refetch()}>Thử lại</button></p>}
    {report.isError && <p className="form-error" role="alert">Chưa tải đủ sổ giao dịch và giá. <button type="button" onClick={() => void report.refetch()}>Thử lại</button></p>}
    {report.isLoading && portfolio.data && <p role="status">Đang đối chiếu sổ giao dịch, vốn và giá…</p>}
    {!portfolio.isLoading && !portfolio.isError && !portfolio.data && <article className="panel portfolio-empty"><h2>Khởi tạo vốn quản lý</h2><p>Nhập một lần để tính sức mua, phân bổ và rủi ro. Sau đó mọi Mua/Bán/Đóng vị thế đều đi qua một luồng giao dịch duy nhất.</p><button className="primary-button" onClick={openCapitalSetup}>Thiết lập vốn ban đầu</button></article>}
    <div hidden={!report.data}><section className="portfolio-overview"><article className="portfolio-nav"><span>Tài sản ròng</span><strong>{money(netAssetValue)}</strong><small>Tiền mặt {money(cash)} · Giá thị trường {money(marketValue)}</small></article><div className="portfolio-summary-grid"><article className="metric-card"><span>Tổng vốn</span><strong>{money(managed)}</strong><small>Vốn đã nộp trừ vốn rút</small></article><article className="metric-card"><span>Tổng giải ngân</span><strong>{money(deployed)}</strong><small>{deployedPct.toFixed(1)}% tổng vốn</small></article><article className="metric-card"><span>Lãi / lỗ danh mục</span><strong className={profitLoss < 0 ? 'negative' : 'positive'}>{profitLoss >= 0 ? '+' : ''}{money(profitLoss)}</strong><small>{returnPct == null ? '—' : `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`} sau loại trừ nộp/rút</small></article><article className="metric-card"><span>Lãi / lỗ hôm nay</span><strong className={(todayProfitLoss ?? 0) < 0 ? 'negative' : 'positive'}>{todayProfitLoss == null ? '—' : `${todayProfitLoss >= 0 ? '+' : ''}${money(todayProfitLoss)}`}</strong><small>{todayReturnPct == null ? 'Chờ giá đóng cửa liền trước' : `${todayReturnPct >= 0 ? '+' : ''}${todayReturnPct.toFixed(2)}%`}</small></article><article className="metric-card"><span>Tài sản ròng bình quân</span><strong>{averageNetAssets == null ? '—' : money(averageNetAssets)}</strong><small>Trung bình NAV theo các ngày trong lịch sử</small></article></div></section>{concentration && <div className="risk-warning"><AlertTriangle size={18}/><span><strong>Cảnh báo tập trung:</strong> Ngành {concentration.label} chiếm {concentration.capitalPct.toFixed(0)}% tổng vốn — vượt ngưỡng 40%.</span></div>}
    <div className="analytics-grid"><article className="analytic-card"><h3>Cơ cấu theo ngành</h3>{allocation.length ? <div className="donut-wrap"><div className="donut interactive-donut" style={{ background: donut }}><span>{positionMetrics.length}<small>vị thế</small></span></div><div className="legend">{allocation.map(item => <button type="button" className={hoveredSector === item.label ? 'active' : ''} onMouseEnter={() => setHoveredSector(item.label)} onFocus={() => setHoveredSector(item.label)} onMouseLeave={() => setHoveredSector(null)} onClick={() => setHoveredSector(value => value === item.label ? null : item.label)} key={item.label}><i style={{ background: item.color }}/>{item.label}<b>{item.pct.toFixed(0)}%</b></button>)}</div></div> : <p className="muted">Phân bổ sẽ xuất hiện khi có vị thế.</p>}{hovered && <div className="sector-donut-tooltip"><strong>{hovered.label}</strong><span>{hovered.pct.toFixed(1)}% giá trị thị trường</span><small>{money(hovered.value)}</small></div>}</article><article className="analytic-card"><h3>Tỷ suất lợi nhuận</h3><ReturnChart points={returnHistory}/></article><article className="analytic-card"><h3>Kịch bản chạm dừng lỗ</h3><div className="risk-number"><strong>-{(managed ? totalRisk : 0).toFixed(1)}%</strong><span>tổng vốn</span></div><p className="muted">Ước tính theo giá hiện tại và stop đã khai báo; chưa gồm gap, phí hoặc mã chưa có stop.</p><div className="risk-track danger"><i style={{ width: `${Math.min(totalRisk / 10 * 100, 100)}%` }}/></div></article><article className="analytic-card"><h3>Ngân sách rủi ro</h3><div className="budget-label"><span>Đã giải ngân</span><b>{money(deployed)} · {deployedPct.toFixed(1)}%</b></div><div className="risk-track"><i style={{ width: `${Math.min(deployedPct, 100)}%` }}/></div><div className="budget-label"><span>Rủi ro đã dùng / Giới hạn mỗi lệnh</span><b>{totalRisk.toFixed(1)}% / {portfolio.data?.max_risk_per_trade_pct ?? 0}%</b></div></article><article className="analytic-card"><h3>Gợi ý khối lượng mua</h3><div className="risk-number"><strong>{sizing ? sizing.toLocaleString('vi-VN') : '—'}</strong><span>cổ phiếu</span></div><p className="muted">Dựa trên vốn quản lý, stop và mức rủi ro mỗi lệnh.</p><div className="signal-preview"><WalletCards size={16}/> Giá và rủi ro đều tính bằng VND</div></article></div>
    <article className="panel"><div className="panel-title"><h3>Cơ cấu danh mục</h3><span>{positionMetrics.length} mã</span></div><div className="data-table portfolio-positions-table"><div className="table-head"><span>Mã</span><span>Khối lượng</span><span>Giá vốn</span><span>Giá thị trường</span><span>Giá trị thị trường</span><span>Lãi / lỗ</span><span>Tỷ trọng</span><span>Giao dịch</span></div>{positionMetrics.map(item => <div className="position-row" key={item.id}><strong>{item.symbols?.symbol}<small>{item.symbols?.sector}</small><small>{lotStates.get(Number(item.symbol_id))?.join(' · ') ?? 'Tuổi lô chưa có dữ liệu'}</small></strong><span>{item.quantity.toLocaleString('vi-VN')} CP</span><span>{money(item.averageCost)}</span><span>{item.marketPrice == null ? '—' : money(item.marketPrice)}</span><span>{money(item.marketValue)}</span><b className={item.profitLoss < 0 ? 'negative' : 'positive'}>{item.profitLoss >= 0 ? '+' : ''}{money(item.profitLoss)}<small>{item.returnPct == null ? '' : `${item.returnPct >= 0 ? '+' : ''}${item.returnPct.toFixed(2)}%`}</small></b><span>{netAssetValue ? (item.marketValue / netAssetValue * 100).toFixed(1) : '0.0'}%</span><div><button onClick={() => openTrade('BUY_ADD', item.symbols?.symbol)}>Mua thêm</button><button onClick={() => openTrade('SELL_REDUCE', item.symbols?.symbol)}>Bán</button><button onClick={() => openTrade('SELL_CLOSE', item.symbols?.symbol)}>Đóng</button></div></div>)}</div>{!positionMetrics.length && <p className="muted">Chưa có vị thế đang mở.</p>}</article><PortfolioTransactions transactions={report.data?.transactions as PortfolioTransaction[] | undefined} loading={report.isLoading} error={report.isError} onRetry={() => void report.refetch()} onEdit={item => openTrade('BUY_NEW', '', item)} onDelete={deleteTransaction}/>
    {portfolio.data && capitalMovements.data?.length ? <article className="panel capital-ledger"><div className="panel-title"><h3>Sổ biến động vốn</h3><span>{capitalMovements.data.length} bút toán</span></div>{[...capitalMovements.data].reverse().map(item=><div className="capital-ledger-row" key={item.id}><time>{item.effective_date.split('-').reverse().join('/')}</time><span>{item.movement_type==='DEPOSIT'?'Nộp vốn':'Rút vốn'}{item.note ? ` · ${item.note}`:''}</span><b className={item.movement_type==='DEPOSIT'?'positive':'negative'}>{item.movement_type==='DEPOSIT'?'+':'-'}{money(Number(item.amount))}</b></div>)}</article> : null}
    <p className="muted">Hiệu suất theo sổ giao dịch và giá vốn bình quân; chưa gồm phí/thuế. Nộp/rút vốn không tính là lợi nhuận.</p>{Boolean(latestLedger?.missingPrices) && <p className="form-error">Một số mã thiếu giá, tạm định giá theo giá vốn; hiệu suất chưa đầy đủ.</p>}</div>
    {setupOpen && <div className="sheet-backdrop" onMouseDown={closeSetup}><form ref={setupRef} role="dialog" aria-modal="true" aria-labelledby="capital-title" tabIndex={-1} className="bottom-sheet position-sheet rule-form" onSubmit={createPortfolio} onMouseDown={event => event.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><h2 id="capital-title">{portfolio.data ? 'Nộp / rút vốn' : 'Khởi tạo danh mục'}</h2><button type="button" className="icon-button" aria-label="Đóng thiết lập vốn" disabled={submitting} onClick={closeSetup}><X size={20}/></button></div>{portfolio.data ? <><label>Loại biến động<SoftSelect value={capitalMode} onChange={event=>setCapitalMode(event.target.value as 'DEPOSIT'|'WITHDRAWAL')}><option value="DEPOSIT">Nộp vốn</option><option value="WITHDRAWAL">Rút vốn</option></SoftSelect></label><CurrencyInput label="Số tiền (VND)" value={capitalAmount} onChange={setCapitalAmount}/><DateField label="Ngày hạch toán" value={capitalDate} onChange={setCapitalDate}/><label>Ghi chú (tuỳ chọn)<textarea rows={2} value={capitalNote} onChange={event=>setCapitalNote(event.target.value)} placeholder="Ví dụ: bổ sung vốn tháng 9"/></label></> : <CurrencyInput label="Vốn quản lý ban đầu (VND)" value={initialCapital} onChange={setInitialCapital}/>}<label>Rủi ro tối đa mỗi lệnh (%)<input min="0.1" step="0.1" type="number" value={maxRisk} onChange={event => setMaxRisk(Number(event.target.value))}/></label><small className="muted">Nộp/rút vốn được ghi thành bút toán riêng; giao dịch mua/bán không làm thay đổi tổng vốn.</small><div className="form-sticky-actions"><button disabled={submitting}>{submitting ? 'Đang lưu…' : portfolio.data ? (capitalMode==='DEPOSIT'?'Ghi nhận nộp vốn':'Ghi nhận rút vốn') : 'Khởi tạo vốn'}</button></div></form></div>}
    {tradeOpen && <div className="sheet-backdrop" onMouseDown={closeTrade}><form ref={tradeRef} role="dialog" aria-modal="true" aria-labelledby="trade-title" tabIndex={-1} className="bottom-sheet position-sheet rule-form" onSubmit={submitTransaction} onMouseDown={event => event.stopPropagation()}><div className="sheet-handle"/><div className="sheet-title"><h2 id="trade-title">{editingTransaction ? 'Chỉnh sửa giao dịch' : 'Giao dịch danh mục'}</h2><button type="button" className="icon-button" aria-label="Đóng giao dịch" disabled={submitting} onClick={closeTrade}><X size={20}/></button></div><SymbolAutocomplete symbols={symbols.data ?? []} value={symbol} onChange={setSymbol} disabled={Boolean(editingTransaction)}/><DateField label="Ngày giao dịch" value={tradingDate} onChange={setTradingDate}/><label>Hành động<SoftSelect value={action} onChange={event => setAction(event.target.value as TransactionAction)}>{Object.entries(transactionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</SoftSelect></label>{isBuyAction && <div className="trade-availability"><span>Sức mua còn lại</span><b>{money(cash)}</b>{price > 0 && <small>Khả dụng tối đa <strong>{availableBuyQuantity.toLocaleString('vi-VN')} CP</strong> tại giá {money(price)}</small>}</div>}{isSellAction && <div className="trade-availability"><span>Khối lượng đang nắm giữ</span><b>{holdingQuantity.toLocaleString('vi-VN')} CP</b><small>{action === 'SELL_CLOSE' ? 'Đóng vị thế sẽ dùng toàn bộ khối lượng này.' : 'Bạn có thể điều chỉnh khối lượng trong giới hạn đang nắm giữ.'}</small></div>}{action !== 'STOP_UPDATE' && <><label className="quantity-input">Khối lượng (cổ phiếu)<QuantityInput value={action === 'SELL_CLOSE' && !editingTransaction ? holdingQuantity : quantity} max={isBuyAction ? availableBuyQuantity : holdingQuantity || undefined} disabled={action === 'SELL_CLOSE' && !editingTransaction} onChange={setQuantity}/></label><CurrencyInput label="Giá giao dịch (VND/cổ phiếu)" value={price} onChange={setPrice}/></>}<CurrencyInput label={action === 'STOP_UPDATE' ? 'Stop mới (VND/cổ phiếu)' : 'Stop (VND/cổ phiếu, tuỳ chọn)'} value={stop} onChange={setStop}/><label>Lý do (tuỳ chọn)<textarea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Thêm lý do nếu cần"/></label><div className="form-sticky-actions"><button disabled={submitting}>{submitting ? 'Đang lưu…' : editingTransaction ? 'Lưu thay đổi' : transactionLabels[action]}</button></div></form></div>}{toast && <div className="toast" role="status"><CheckCircle2 size={18}/>{toast}</div>}</section>
}
