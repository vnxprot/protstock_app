export type HealthComponents = Record<string, { value: number | null; valid_count: number; coverage_pct: number }>
const labels: Record<string,string> = { above_sma20: 'Trên SMA20', above_sma50: 'Trên SMA50', above_sma200: 'Trên SMA200', ma_stack: 'MA20 > MA50 > MA200', advances: 'Tỷ lệ mã tăng' }
export function HealthMethodDetails({ components, version }: { components?: HealthComponents; version?: string }) {
  if (!components) return null
  return <details className="health-method-details"><summary>Độ phủ từng chỉ báo · {version ?? 'Chưa ghi phiên bản'}</summary><p>Chỉ báo thiếu được ghi riêng. Điểm sức khỏe dùng các thành phần có dữ liệu hợp lệ.</p><table><thead><tr><th>Thành phần</th><th>Tỷ lệ</th><th>Mẫu hợp lệ</th><th>Độ phủ</th></tr></thead><tbody>{Object.entries(components).map(([key,item])=><tr key={key}><td>{labels[key] ?? key}</td><td>{item.value == null ? '—' : `${Number(item.value).toFixed(1)}%`}</td><td>{item.valid_count}</td><td>{Number(item.coverage_pct).toFixed(1)}%</td></tr>)}</tbody></table></details>
}
