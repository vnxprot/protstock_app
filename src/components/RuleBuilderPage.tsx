import { FormEvent, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

type Condition = Record<string, string | number>

function compileText(input: string) {
  const text = input.toLowerCase().replace(',', '.')
  const all: Condition[] = []
  const breakout = text.match(/(?:vượt đỉnh|breakout)\s+(\d+)/)
  const volume = text.match(/(?:volume|khối lượng)\s+(?:lớn hơn|>)\s+(\d+(?:\.\d+)?)\s*lần/)
  const rsi = text.match(/rsi(?:\s*14)?\s*(?:từ|trong khoảng)\s*(\d+(?:\.\d+)?)\s*(?:đến|-)\s*(\d+(?:\.\d+)?)/)
  if (breakout) all.push({ metric: 'close', op: 'breakout_high', lookback: Number(breakout[1]) })
  if (volume) all.push({ metric: 'volume_ratio20', op: '>', value: Number(volume[1]) })
  if (/ma\s*20\s*>\s*ma\s*50\s*>\s*ma\s*200/.test(text)) all.push({ metric: 'ma_stack', op: 'bullish' })
  if (rsi) all.push({ metric: 'rsi14', op: 'between', min: Number(rsi[1]), max: Number(rsi[2]) })
  const stop = text.match(/(?:stop-loss|cắt lỗ)\s*(\d+(?:\.\d+)?)\s*%/)
  if (stop) all.push({ metric: 'return_from_entry', op: '<=', value: -Number(stop[1]) / 100 })
  if (!all.length) throw new Error('Chưa nhận ra điều kiện. Dùng breakout, volume, MA, RSI hoặc stop-loss.')
  return { version: 1, action: /bán|thoát|stop-loss|cắt lỗ/.test(text) ? 'SELL' : 'BUY', timeframe: text.includes('tuần') ? 'W' : text.includes('tháng') ? 'M' : 'D', all }
}

async function sha256(value: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(data)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function RuleBuilderPage({ authenticated }: { authenticated: boolean }) {
  const client = useQueryClient()
  const [name, setName] = useState('Breakout có xác nhận')
  const [input, setInput] = useState('Mua khi giá đóng cửa vượt đỉnh 20 phiên, volume lớn hơn 1.5 lần, MA20 > MA50 > MA200 và RSI từ 45 đến 70')
  const [message, setMessage] = useState('')
  const preview = useMemo(() => { try { return { dsl: compileText(input), error: '' } } catch (error) { return { dsl: null, error: (error as Error).message } } }, [input])
  const rules = useQuery({
    queryKey: ['rules'], enabled: authenticated && Boolean(supabase),
    queryFn: async () => { const { data, error } = await supabase!.from('rules').select('id,name,input_text,status,created_at').order('created_at', { ascending: false }); if (error) throw error; return data ?? [] },
  })

  async function save(event: FormEvent) {
    event.preventDefault(); setMessage('')
    if (!supabase || !preview.dsl) return
    const { data: rule, error } = await supabase.from('rules').insert({ name, input_text: input, status: 'ACTIVE' }).select('id').single()
    if (error) return setMessage(error.message)
    const canonical = JSON.stringify(preview.dsl)
    const { error: versionError } = await supabase.from('rule_versions').insert({ rule_id: rule.id, version: 1, dsl: preview.dsl, compiled_hash: await sha256(canonical) })
    if (versionError) return setMessage(versionError.message)
    setMessage('Đã lưu rule version 1. Lần sửa sau sẽ tạo version mới, không đổi kết quả cũ.')
    client.invalidateQueries({ queryKey: ['rules'] })
  }

  return <section className="workspace-page">
    <span className="eyebrow">PHASE 3 · RULE ENGINE</span><h1>Rule Builder</h1>
    <div className="analysis-columns">
      <form className="panel rule-form" onSubmit={save}>
        <label>Tên rule<input value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Mô tả bằng lời<textarea rows={7} value={input} onChange={event => setInput(event.target.value)} /></label>
        <button disabled={!preview.dsl}>Lưu và kích hoạt</button>
        {(message || preview.error) && <p className={preview.error ? 'form-error' : 'form-ok'}>{preview.error || message}</p>}
      </form>
      <article className="panel"><div className="panel-title"><h3>Bản dịch có kiểm soát</h3><span>DSL v1</span></div>
        <pre className="dsl-preview">{preview.dsl ? JSON.stringify(preview.dsl, null, 2) : '—'}</pre>
        <p className="muted">AI sau này chỉ hỗ trợ dịch câu chữ sang DSL này; engine không chạy code do AI tạo.</p>
      </article>
    </div>
    <article className="panel"><div className="panel-title"><h3>Rules của Prot</h3><span>{rules.data?.length ?? 0}</span></div>
      {(rules.data ?? []).map(rule => <div className="rule-row" key={rule.id}><div><strong>{rule.name}</strong><small>{rule.input_text}</small></div><span>{rule.status}</span></div>)}
      {!rules.isLoading && !rules.data?.length && <p className="muted">Chưa có rule nào.</p>}
    </article>
  </section>
}

