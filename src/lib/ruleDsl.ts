export type RuleCondition = Record<string, string | number>
export type RuleDsl = {
  version: 2
  action: 'WATCH' | 'PROBE_BUY' | 'REDUCE' | 'EXIT'
  timeframe: 'D' | 'W' | 'M'
  all: RuleCondition[]
  risk?: { stop_loss_pct: number }
}

// Deliberately restricted grammar. Keep in parity with protstock.rules.
export function compileRuleText(input: string): RuleDsl {
  const text = input.toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim()
  let residue = text
  const all: RuleCondition[] = []
  const actionWords = text.match(/(?<![\p{L}\p{N}_])(?:theo dõi|bán hết|thoát|giảm tỷ trọng|bán|mua)(?![\p{L}\p{N}_])/gu) ?? []
  const explicitActions = new Set<RuleDsl['action']>(actionWords.map(word => word === 'theo dõi' ? 'WATCH' : word === 'thoát' || word === 'bán hết' ? 'EXIT' : word === 'bán' || word === 'giảm tỷ trọng' ? 'REDUCE' : 'PROBE_BUY'))
  if (explicitActions.size > 1) throw new Error('Chỉ mô tả một hành động trong mỗi quy tắc.')
  const action = explicitActions.values().next().value ?? 'PROBE_BUY'
  const result: RuleDsl = { version: 2, action, timeframe: text.includes('tuần') ? 'W' : text.includes('tháng') ? 'M' : 'D', all }
  function take(expression: RegExp): RegExpMatchArray | null {
    const matches = [...text.matchAll(new RegExp(expression.source, 'gu'))]
    if (matches.length > 1) throw new Error('Mỗi loại điều kiện chỉ được khai báo một lần.')
    if (!matches.length) return null
    residue = residue.replace(new RegExp(expression.source, 'gu'), ' ')
    return matches[0]
  }
  const breakout = take(/(?:vượt đỉnh|breakout)(?:\s+đỉnh)?\s+(\d+)\s*(?:phiên)?/)
  if (breakout) {
    const lookback = Number(breakout[1])
    if (lookback < 1 || lookback > 500) throw new Error('Số phiên breakout phải nằm trong 1–500.')
    all.push({ metric: 'close', op: 'breakout_high', lookback })
  }
  const volume = take(/(?:volume|khối lượng)\s+(?:lớn hơn|>)\s+(\d+(?:\.\d+)?)\s*lần/)
  if (volume) {
    const value = Number(volume[1])
    if (value <= 0 || value > 100) throw new Error('Hệ số khối lượng phải lớn hơn 0 và không quá 100.')
    all.push({ metric: 'volume_ratio20', op: '>', value })
  }
  if (take(/ma\s*20\s*>\s*ma\s*50\s*>\s*ma\s*200/)) all.push({ metric: 'ma_stack', op: 'bullish' })
  const rsi = take(/rsi(?:\s*14)?\s*(?:từ|trong khoảng)\s*(\d+(?:\.\d+)?)\s*(?:đến|-)\s*(\d+(?:\.\d+)?)/)
  if (rsi) {
    const min = Number(rsi[1]), max = Number(rsi[2])
    if (min < 0 || min > max || max > 100) throw new Error('Khoảng RSI phải tăng dần trong 0–100.')
    all.push({ metric: 'rsi14', op: 'between', min, max })
  }
  const names: Record<string, string> = { 'nền tích lũy': 'ACCUMULATION_BASE', 'double bottom': 'DOUBLE_BOTTOM', 'hai đáy': 'DOUBLE_BOTTOM', 'double top': 'DOUBLE_TOP', 'hai đỉnh': 'DOUBLE_TOP', 'tam giác tăng': 'ASCENDING_TRIANGLE', 'cờ tăng': 'BULL_FLAG' }
  const pattern = take(/(nền tích lũy|double bottom|hai đáy|double top|hai đỉnh|tam giác tăng|cờ tăng)(?:\s+(?:đã\s+)?(xác nhận|sẵn sàng))?/)
  if (pattern) all.push({ metric: 'pattern', op: pattern[2] === 'sẵn sàng' ? 'ready' : 'confirmed', type: names[pattern[1]] })
  const stop = take(/(?:stop-loss|cắt lỗ)\s*(\d+(?:\.\d+)?)\s*%(?:\s+từ giá vốn)?/)
  if (stop) {
    const value = Number(stop[1]) / 100
    if (value <= 0 || value >= 1) throw new Error('Cắt lỗ phải lớn hơn 0% và nhỏ hơn 100%.')
    if (all.length && result.action === 'PROBE_BUY') result.risk = { stop_loss_pct: value }
    else if (!all.length) {
      if (explicitActions.has('PROBE_BUY')) throw new Error('Cắt lỗ là điều kiện thoát; thêm điều kiện mua trước khi đặt mức cắt lỗ.')
      result.action = 'EXIT'
      all.push({ metric: 'return_from_entry', op: '<=', value: -value })
    } else throw new Error('Tách quy tắc bán/theo dõi và cắt lỗ thành hai quy tắc rõ ràng.')
  }
  residue = residue.replace(/(?<![\p{L}\p{N}_])(?:theo dõi|giá đóng cửa|mẫu hình|khung ngày|khung tuần|khung tháng|bán hết|giảm tỷ trọng|mua|bán|thoát|khi|và|ngày|tuần|tháng)(?![\p{L}\p{N}_])/gu, ' ').replace(/[\s,;.]+/g, ' ').trim()
  if (residue) throw new Error('Chưa hiểu phần: ' + residue + '. Hãy dùng các điều kiện được hỗ trợ.')
  if (!all.length) throw new Error('Không nhận ra điều kiện. Hãy dùng breakout, volume, MA, RSI, mẫu hình hoặc stop-loss.')
  return result
}

export function explainRule(dsl: RuleDsl): string[] {
  const conditions = dsl.all.map(condition => {
    if (condition.metric === 'pattern') return 'Mẫu hình ' + condition.type + (condition.op === 'ready' ? ' sẵn sàng' : ' đã xác nhận')
    if (condition.op === 'breakout_high') return 'Đóng cửa vượt đỉnh đủ ' + condition.lookback + ' nến trước'
    if (condition.metric === 'volume_ratio20') return 'Khối lượng / trung bình 20 > ' + condition.value + ' lần'
    if (condition.metric === 'ma_stack') return 'MA20 > MA50 > MA200'
    if (condition.metric === 'rsi14') return 'RSI14 trong ' + condition.min + '–' + condition.max
    return 'Lợi nhuận từ giá vốn ≤ ' + (Number(condition.value) * 100).toFixed(1) + '%'
  })
  if (dsl.risk) conditions.push('Dừng lỗ ' + (dsl.risk.stop_loss_pct * 100).toFixed(1) + '% từ giá mua thực tế')
  return conditions
}
