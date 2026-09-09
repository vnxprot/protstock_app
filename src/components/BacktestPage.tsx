import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function BacktestPage({ authenticated }: { authenticated: boolean }) {
  const runs = useQuery({ queryKey: ['backtests'], enabled: authenticated && Boolean(supabase), queryFn: async () => { const { data, error } = await supabase!.from('backtest_runs').select('id,name,date_from,date_to,status,metrics,benchmark_metrics,created_at,rule_versions(rules(name))').order('created_at', { ascending: false }); if (error) throw error; return data ?? [] } })
  return <section className="workspace-page"><span className="eyebrow">PHASE 4 · WALK-FORWARD</span><h1>Backtest</h1>
    <article className="panel"><div className="panel-title"><h3>Kết quả bất biến theo rule version</h3><span>{runs.data?.length ?? 0}</span></div>{runs.isError && <p className="form-error">Chưa đọc được schema Phase 4.</p>}{(runs.data ?? []).map((run: any) => <div className="rule-row" key={run.id}><div><strong>{run.name}</strong><small>{run.date_from} → {run.date_to} · {run.rule_versions?.rules?.name}</small></div><span>{run.status}</span></div>)}{!runs.isLoading && !runs.data?.length && <p className="muted">Chưa có lượt backtest. Engine đã hỗ trợ phí, thuế, trượt giá, thanh khoản, stop và walk-forward.</p>}</article>
  </section>
}
