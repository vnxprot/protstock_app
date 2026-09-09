import { useEffect, useState } from 'react'
import { useStockAnalysis, useSymbols } from '../hooks/useStockAnalysis'
import { StockChart } from './StockChart'

const patternNames: Record<string, string> = {
  ACCUMULATION_BASE: 'Nền tích lũy', DOUBLE_BOTTOM: 'Hai đáy', DOUBLE_TOP: 'Hai đỉnh',
  ASCENDING_TRIANGLE: 'Tam giác tăng', DESCENDING_TRIANGLE: 'Tam giác giảm',
  SYMMETRICAL_TRIANGLE: 'Tam giác cân', BULL_FLAG: 'Cờ tăng', BEAR_FLAG: 'Cờ giảm',
}

const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : Number(value).toLocaleString('vi-VN', { maximumFractionDigits: digits })

export function AnalysisPage({ authenticated }: { authenticated: boolean }) {
  const symbols = useSymbols(authenticated)
  const [selected, setSelected] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<'D' | 'W' | 'M'>('D')
  useEffect(() => {
    if (!selected && symbols.data?.length) setSelected(symbols.data.find(item => item.symbol === 'FPT')?.symbol ?? symbols.data[0].symbol)
  }, [selected, symbols.data])
  const analysis = useStockAnalysis(selected, timeframe, authenticated)
  const snapshot = analysis.data?.technical[0]

  return <section className="workspace-page">
    <div className="page-title-row">
      <div><span className="eyebrow">PHASE 2 · CORE ANALYSIS</span><h1>Phân tích một mã</h1></div>
      <label className="symbol-picker">Mã cổ phiếu
        <select value={selected ?? ''} onChange={event => setSelected(event.target.value)}>
          {(symbols.data ?? []).map(item => <option key={item.symbol} value={item.symbol}>{item.symbol} · {item.sector}</option>)}
        </select>
      </label>
    </div>
    <div className="timeframe-tabs" aria-label="Khung thời gian">
      {([['D', 'Ngày'], ['W', 'Tuần'], ['M', 'Tháng']] as const).map(([value, label]) =>
        <button className={timeframe === value ? 'active' : ''} key={value} onClick={() => setTimeframe(value)}>{label}</button>
      )}
    </div>

    {analysis.isLoading && <div className="empty-state">Đang tải dữ liệu phân tích…</div>}
    {analysis.isError && <div className="empty-state warning">Chưa đọc được dữ liệu Phase 2. Kiểm tra migration và pipeline EOD.</div>}
    {analysis.data && <>
      <div className="stock-heading">
        <div><h2>{analysis.data.symbol.symbol}</h2><p>{analysis.data.symbol.company_name || analysis.data.symbol.sector} · {analysis.data.symbol.exchange}</p></div>
        <div className={`trend-badge ${snapshot?.trend_state?.toLowerCase() ?? ''}`}>{snapshot?.trend_state ?? 'CHƯA CÓ SNAPSHOT'}</div>
      </div>
      {analysis.data.prices.length ? <StockChart bars={analysis.data.prices} /> : <div className="empty-state">Chưa có OHLCV. Pipeline EOD sẽ điền dữ liệu sau phiên.</div>}
      <div className="metric-grid">
        {[
          ['Đóng cửa', snapshot?.close], ['RSI 14', snapshot?.rsi14], ['MACD', snapshot?.macd], ['ATR 14', snapshot?.atr14],
          ['MA 20', snapshot?.sma20], ['MA 50', snapshot?.sma50], ['MA 200', snapshot?.sma200], ['Volume / TB20', snapshot?.volume_ratio20],
        ].map(([label, value]) => <article className="metric-card" key={label as string}><span>{label}</span><strong>{number(value as number | null)}</strong></article>)}
      </div>
      <div className="analysis-columns">
        <article className="panel"><div className="panel-title"><h3>Mẫu hình giá</h3><span>{analysis.data.patterns.length}</span></div>
          {analysis.data.patterns.length ? analysis.data.patterns.map(pattern => <div className="pattern-row" key={pattern.id}>
            <div><strong>{patternNames[pattern.pattern_type] ?? pattern.pattern_type}</strong><small>{pattern.timeframe} · {pattern.state} · {pattern.direction}</small></div>
            <div className="score">{number(pattern.quality_score, 0)}</div>
            <p>{pattern.reasons.join(' · ')}</p>
          </div>) : <p className="muted">Chưa phát hiện mẫu hình đủ tiêu chuẩn.</p>}
        </article>
        <article className="panel"><div className="panel-title"><h3>Vì sao có tín hiệu này?</h3><span>Giải thích</span></div>
          <ul className="reason-list">
            <li>Xu hướng D/W/M được đánh giá độc lập trên bar đã hoàn tất.</li>
            <li>Mẫu hình nến chỉ là bằng chứng bổ sung, không tự phát tín hiệu.</li>
            <li>Breakout phải đóng cửa ngoài vùng cản và lưu snapshot bằng chứng.</li>
            <li>Dữ liệu công bố chỉ dùng từ ngày <code>available_from</code>.</li>
          </ul>
        </article>
      </div>
      <article className="panel"><div className="panel-title"><h3>Sự kiện & công bố</h3><span>Point-in-time safe</span></div>
        {analysis.data.disclosures.length ? analysis.data.disclosures.map(item => <a className="event-row" href={item.source_url} target="_blank" rel="noreferrer" key={item.id}><span>{new Date(item.published_at).toLocaleDateString('vi-VN')}</span><strong>{item.title}</strong><small>{item.source}</small></a>) : <p className="muted">Chưa có công bố chính thức được thu thập.</p>}
      </article>
    </>}
  </section>
}
