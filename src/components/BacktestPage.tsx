import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useSymbols } from '../hooks/useStockAnalysis'
import { SoftSelect } from './SoftSelect'
import { DateField } from './DateField'
import { compareEngines } from '../lib/engineCatalog'
import { displayStructureName, displaySystemRevision } from '../lib/releaseLabels'
import { LoadingLabel } from './LoadingLabel'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const stateLabels: Record<string, string> = { QUEUED: 'Đang chờ', RUNNING: 'Đang tính', SUCCEEDED: 'Hoàn tất', FAILED: 'Chưa hoàn tất' }

export function BacktestPage({ authenticated }: { authenticated: boolean }) {
  const client = useQueryClient()
  const symbols = useSymbols(authenticated)
  const [symbol, setSymbol] = useState('FPT'), [versionId, setVersionId] = useState('')
  const [dateFrom, setDateFrom] = useState('2024-01-01'), [dateTo, setDateTo] = useState(today)
  const [capital, setCapital] = useState(100000000), [riskPct, setRiskPct] = useState(1), [holdBars, setHoldBars] = useState(20)
  const [submitting, setSubmitting] = useState(false), [message, setMessage] = useState(''), [formError, setFormError] = useState('')
  const versions = useQuery({
    queryKey: ['rule-versions'], enabled: authenticated && Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!.from('rule_versions').select('id,rule_id,version,dsl,compiled_hash,rules!inner(name,status,kind)')
        .in('rules.status', ['ACTIVE', 'PAUSED', 'DRAFT']).order('version', { ascending: false })
      if (error) throw error
      const latest = new Map()
      for (const row of data ?? []) if (!latest.has(row.rule_id)) latest.set(row.rule_id, row)
      return [...latest.values()].filter(row => (row.dsl?.timeframes ?? [row.dsl?.timeframe ?? 'D']).includes('D'))
        .sort((a: any, b: any) => compareEngines(a.rules, b.rules))
    },
  })
  const runs = useQuery({
    queryKey: ['backtests'], enabled: authenticated && Boolean(supabase),
    queryFn: async () => {
      const { data, error } = await supabase!.from('backtest_runs')
        .select('id,name,date_from,date_to,status,metrics,benchmark_metrics,error_message,algorithm_version,data_revision,created_at,symbols(symbol),rule_versions(version,rules(name))')
        .order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return data ?? []
    },
    refetchInterval: query => query.state.data?.some((run: any) => ['QUEUED', 'RUNNING'].includes(run.status)) ? 10000 : false,
  })
  async function queue(event: FormEvent) {
    event.preventDefault()
    setMessage(''); setFormError('')
    const chosen = versions.data?.find(item => item.id === versionId)
    const symbolId = symbols.data?.find(item => item.symbol === symbol)?.id
    if (!supabase || !chosen || !symbolId) return setFormError('Chọn phiên bản quy tắc và mã hợp lệ.')
    if (!dateFrom || !dateTo || dateFrom > dateTo || dateTo > today()) return setFormError('Khoảng thời gian phải hợp lệ và kết thúc không quá hôm nay.')
    if (!Number.isFinite(capital) || capital <= 0 || !Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 100 || !Number.isInteger(holdBars) || holdBars < 1) return setFormError('Kiểm tra vốn, mức rủi ro và số phiên giữ tối đa.')
    setSubmitting(true)
    try {
      const { error } = await supabase.from('backtest_runs').insert({
        rule_version_id: chosen.id, symbol_id: symbolId, timeframe: 'D',
        name: symbol + ' · ' + dateFrom + ' → ' + dateTo, date_from: dateFrom, date_to: dateTo,
        assumptions: { initial_capital: capital, risk_pct: riskPct, lot_size: 100, fee_rate: .0015, sell_tax_rate: .001,
          slippage_rate: .001, stop_loss_pct: .07, trailing_stop_pct: .1, time_stop_bars: holdBars, max_sector_weight_pct: 30 },
      })
      if (error) throw error
      setMessage('Đã đưa vào hàng chờ. Bạn có thể rời trang; kết quả sẽ được cập nhật khi xử lý xong.')
      await client.invalidateQueries({ queryKey: ['backtests'] })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Chưa tạo được lượt kiểm thử. Vui lòng thử lại.')
    } finally { setSubmitting(false) }
  }
  return <section className="workspace-page">
    <div className="page-title-row"><div><h1>Kiểm thử lịch sử</h1><p className="muted">Kiểm chứng một phiên bản quy tắc với dữ liệu và giả định được khóa theo lượt chạy.</p></div></div>
    <div className="analysis-columns">
      <form className="panel rule-form" onSubmit={queue}>
        <label>Phiên bản quy tắc<SoftSelect value={versionId} onChange={e => setVersionId(e.target.value)}>
          <option value="">Chọn quy tắc để kiểm thử</option>
          {(versions.data ?? []).map((item: any) => <option value={item.id} key={item.id}>{displayStructureName(item.rules?.name ?? '')} · quy tắc {item.version}{item.rules?.status === 'DRAFT' ? ' · bản nháp' : ''}</option>)}
        </SoftSelect></label>
        {versions.isError && <p className="form-error">Chưa tải được quy tắc. Hãy thử lại sau.</p>}
        <label>Mã<SoftSelect value={symbol} onChange={e => setSymbol(e.target.value)}>{(symbols.data ?? []).map(item => <option key={item.id}>{item.symbol}</option>)}</SoftSelect></label>
        <DateField label="Từ ngày" value={dateFrom} onChange={setDateFrom}/><DateField label="Đến ngày" value={dateTo} onChange={setDateTo}/>
        <details><summary>Vốn và quản trị rủi ro</summary>
          <label>Vốn ban đầu · đồng<input type="number" min="1" step="1000000" value={capital} onChange={e => setCapital(Number(e.target.value))}/></label>
          <label>Rủi ro mỗi vị thế · % vốn<input type="number" min=".1" max="100" step=".1" value={riskPct} onChange={e => setRiskPct(Number(e.target.value))}/></label>
          <label>Giữ tối đa · phiên<input type="number" min="1" step="1" value={holdBars} onChange={e => setHoldBars(Number(e.target.value))}/></label>
        </details>
        <button disabled={submitting || !versionId || !versions.data?.length}>{submitting ? <LoadingLabel>Đang tạo lượt kiểm thử…</LoadingLabel> : 'Chạy kiểm thử'}</button>
        {formError && <p className="form-error" role="alert">{formError}</p>}{message && <p className="form-ok" role="status">{message}</p>}
      </form>
      <article className="panel"><div className="panel-title"><h3>Cách mô phỏng</h3><span>SAU PHIÊN</span></div>
        <ul className="reason-list"><li>Tín hiệu sau đóng cửa, khớp ở mở cửa phiên kế tiếp.</li><li>Dừng lỗ được kiểm tra trên giá đóng cửa, bán ở mở cửa hợp lệ kế tiếp; trong T và T+1 cổ phiếu mới mua chưa thể bán.</li><li>Lô 100 cổ phiếu, vốn và giá giao dịch tính bằng đồng.</li><li>Hàng mua T khả dụng từ chiều T+2. Lệnh khẩn cấp có thể giả định bán tại đóng cửa T+2; mặc định EOD bán ở mở cửa T+3. Giá thấp nhất ngày T+2 chỉ là proxy bảo thủ cho buổi sáng.</li><li>Phí mỗi chiều 0,15%, thuế bán 0,1%, trượt giá mỗi chiều 0,1% là giả định của lượt chạy.</li><li>Stop mặc định 7%, trailing 10%; stop trong quy tắc được ưu tiên.</li><li>Thiếu dữ liệu thị trường hoặc khung Tháng sẽ chặn entry và được ghi rõ trong kết quả.</li></ul>
        <p className="muted">Kết quả dùng để nghiên cứu. Mẫu hình và điểm đồng thuận không phải xác suất lợi nhuận.</p>
      </article>
    </div>
    <article className="panel"><div className="panel-title"><h3>Kết quả gần đây</h3><span>{runs.data?.length ?? 0}</span></div>
      {runs.isError && <p className="form-error" role="alert">Chưa đọc được kết quả kiểm thử.</p>}
      {(runs.data ?? []).map((run: any) => <div className="rule-row" key={run.id}><div>
        <strong>{run.name}</strong><small>{displayStructureName(run.rule_versions?.rules?.name ?? '')} · quy tắc {run.rule_versions?.version}</small>
        {run.status === 'SUCCEEDED' ? <><small>{Number(run.metrics?.trade_count ?? 0)} giao dịch · Lợi nhuận {((run.metrics?.total_return ?? 0) * 100).toFixed(1)}% · Sụt giảm tối đa {((run.metrics?.max_drawdown ?? 0) * 100).toFixed(1)}% · Sharpe {(run.metrics?.sharpe ?? 0).toFixed(2)}</small>
          {(run.metrics?.warnings ?? []).includes('MARKET_CONTEXT_MISSING') && <p className="form-error">Một số phiên thiếu bối cảnh thị trường; các entry tương ứng đã bị chặn.</p>}
          {!run.metrics?.trade_count && <small>Không có entry đủ điều kiện trong khoảng đã chọn. Xem số phiên bị chặn trước khi đánh giá quy tắc.</small>}
          <details><summary>Phạm vi và chất lượng lượt chạy</summary><p>{run.metrics?.evaluation_summary?.evaluated ?? '—'} phiên đánh giá · {run.metrics?.evaluation_summary?.entry_blocked ?? '—'} entry bị chặn · {run.metrics?.evaluation_summary?.market_context_missing ?? '—'} phiên thiếu market context</p><p>Cơ sở giá: {run.metrics?.price_basis === 'KBS_VENDOR_REBASED' ? 'Lịch sử KBS đã đối chiếu' : run.metrics?.price_basis === 'STORED_VERIFIED' ? 'Giá EOD lưu trữ đã qua kiểm tra' : 'Lượt chạy cũ chưa ghi cơ sở giá'}. Dữ liệu chưa xác minh hoặc có bất thường về đơn vị bị chặn.</p><p title={run.metrics?.execution_algorithm_version ?? run.algorithm_version ?? undefined}>Phiên bản tính toán: {displaySystemRevision(run.metrics?.execution_algorithm_version ?? run.algorithm_version)} · Vân tay dữ liệu tính toán: {run.metrics?.execution_data_revision?.slice(0, 12) ?? 'Chưa ghi'}</p><p>Revision dữ liệu lúc tạo lượt: {run.data_revision ?? 'Lượt chạy cũ'}</p></details>
        </> : run.status === 'FAILED' ? <p className="form-error" role="alert">{run.error_message ?? 'Chưa tính được kết quả. Tạo lượt mới sau khi kiểm tra dữ liệu.'}</p> : <small>Lượt chạy đang được xử lý theo hàng chờ; kết quả tự cập nhật.</small>}
      </div><span>{stateLabels[run.status] ?? run.status}</span></div>)}
      {runs.isLoading && <p className="muted" role="status">Đang tải kết quả…</p>}
      {!runs.isLoading && !runs.isError && !runs.data?.length && <p className="muted">Chưa có lượt kiểm thử. Chọn một bản nháp hoặc quy tắc đang bật để bắt đầu.</p>}
    </article>
  </section>
}
