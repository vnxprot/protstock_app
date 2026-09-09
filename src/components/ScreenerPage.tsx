import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function ScreenerPage({ authenticated }: { authenticated: boolean }) {
  const signals = useQuery({
    queryKey: ['signals'], enabled: authenticated && Boolean(supabase),
    queryFn: async () => { const { data, error } = await supabase!.from('signals').select('id,as_of_date,timeframe,action,score,reasons,symbols(symbol),rule_versions(rules(name))').order('as_of_date', { ascending: false }).order('score', { ascending: false }).limit(100); if (error) throw error; return data ?? [] },
  })
  return <section className="workspace-page"><span className="eyebrow">PHASE 3 · SCREENER</span><h1>Tín hiệu sau phiên</h1>
    <article className="panel"><div className="panel-title"><h3>Kết quả rules đang bật</h3><span>{signals.data?.length ?? 0} tín hiệu</span></div>
      {signals.isError && <p className="form-error">Chưa đọc được schema Phase 3.</p>}
      {(signals.data ?? []).map((signal: any) => <div className="signal-row" key={signal.id}><strong>{signal.symbols?.symbol}</strong><span>{signal.action} · {signal.timeframe}</span><span>{signal.score}</span><small>{signal.as_of_date} · {signal.rule_versions?.rules?.name}</small></div>)}
      {!signals.isLoading && !signals.data?.length && <p className="muted">Chưa có tín hiệu. Rule sẽ được đánh giá sau pipeline EOD.</p>}
    </article>
  </section>
}
