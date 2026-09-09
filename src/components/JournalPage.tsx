import { FormEvent, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useSymbols } from '../hooks/useStockAnalysis'

export function JournalPage({ authenticated }: { authenticated: boolean }) {
  const client = useQueryClient(); const symbols = useSymbols(authenticated)
  const [symbol, setSymbol] = useState('FPT'); const [decision, setDecision] = useState('SKIP'); const [rationale, setRationale] = useState('')
  const entries = useQuery({ queryKey: ['journal'], enabled: authenticated && Boolean(supabase), queryFn: async () => { const { data, error } = await supabase!.from('journal_entries').select('id,decision_date,decision,setup_type,market_state,rationale,result_pct,outcome,lesson,symbols(symbol,sector)').order('decision_date', { ascending: false }).limit(100); if (error) throw error; return data ?? [] } })
  async function save(event: FormEvent) { event.preventDefault(); const symbolId = symbols.data?.find(item => item.symbol === symbol)?.id; if (!symbolId || !rationale.trim()) return; await supabase!.from('journal_entries').insert({ symbol_id: symbolId, decision_date: new Date().toISOString().slice(0, 10), decision, rationale, outcome: 'OPEN' }); setRationale(''); client.invalidateQueries({ queryKey: ['journal'] }) }
  const losses = (entries.data ?? []).filter((item: any) => item.outcome === 'LOSS')
  return <section className="workspace-page"><span className="eyebrow">PHASE 5 · FEEDBACK LOOP</span><h1>Nhật ký quyết định</h1>
    <div className="metric-grid"><article className="metric-card"><span>Tổng quyết định</span><strong>{entries.data?.length ?? 0}</strong></article><article className="metric-card"><span>Lệnh sai</span><strong>{losses.length}</strong></article><article className="metric-card"><span>Setup sai nhiều nhất</span><strong>{losses[0]?.setup_type ?? '—'}</strong></article><article className="metric-card"><span>Ngành cần lưu ý</span><strong>{(losses[0] as any)?.symbols?.sector ?? '—'}</strong></article></div>
    <div className="analysis-columns"><form className="panel rule-form" onSubmit={save}><label>Mã<select value={symbol} onChange={e => setSymbol(e.target.value)}>{(symbols.data ?? []).map(item => <option key={item.id}>{item.symbol}</option>)}</select></label><label>Quyết định<select value={decision} onChange={e => setDecision(e.target.value)}>{['BUY','SKIP','SELL','HOLD','STOP'].map(item => <option key={item}>{item}</option>)}</select></label><label>Lý do<textarea rows={6} value={rationale} onChange={e => setRationale(e.target.value)} /></label><button>Lưu quyết định</button></form>
    <article className="panel"><div className="panel-title"><h3>Dòng thời gian</h3><span>{entries.data?.length ?? 0}</span></div>{(entries.data ?? []).map((item: any) => <div className="rule-row" key={item.id}><div><strong>{item.symbols?.symbol} · {item.decision}</strong><small>{item.decision_date} · {item.rationale}</small></div><span>{item.outcome ?? 'OPEN'}</span></div>)}</article></div>
  </section>
}
