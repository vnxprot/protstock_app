import { CardHeader } from './CardHeader'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { vciValue, type VciOverview } from '../lib/vciOverview'

export function VciCompanyCard({ symbolId, historical = false }: { symbolId: number; historical?: boolean }) {
  const query = useQuery({
    queryKey: ['vci-overview', symbolId], enabled: Boolean(supabase), staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase!.from('canslim_vci_data')
        .select('overview,overview_error,overview_attempted_at').eq('symbol_id', symbolId).maybeSingle()
      if (error) throw error
      return data as { overview: VciOverview; overview_error: string | null } | null
    },
  })
  const value = query.data?.overview ?? {}
  const fields = [
    ['Vốn hóa', vciValue(value.market_cap, ' tỷ', 1e9)],
    ['Tỷ lệ trôi nổi', vciValue(value.free_float_pct, '%')],
    ['CP lưu hành', vciValue(value.shares, ' tr CP', 1e6)],
    ['CP trôi nổi', vciValue(value.free_float_shares, ' tr CP', 1e6)],
    ['P/E · TTM', vciValue(value.pe, '×')], ['P/B', vciValue(value.pb, '×')],
    [value.eps_basis ?? 'EPS cơ bản', vciValue(value.eps, ' đ/CP')], ['Kỳ EPS', value.eps_period ?? '—'],
    ['ROE · TTM', vciValue(value.roe, '%')], ['ROA · TTM', vciValue(value.roa, '%')],
  ]
  return <article className="panel quant-card quant-fundamentals" aria-label="Chỉ số doanh nghiệp VCI">
    <CardHeader title="Chỉ số doanh nghiệp" status={<span className="quant-caption">VCI</span>}/>
    <div className="quant-card-body"><dl className="quant-fundamental-grid">{fields.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
    <p className="quant-caption">Tỷ số {value.ratio_basis ?? 'TTM'} · {value.ratio_period ?? 'Chưa có kỳ'}</p>
    <p className="quant-caption">{value.fetched_at ? `Lấy từ VCI: ${new Date(value.fetched_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` : query.isFetching ? 'Đang tải chỉ số VCI…' : 'Đang chờ tác vụ cập nhật VCI.'}</p>
    {(query.isError || query.data?.overview_error) && <p className="quant-risk-note" role="status">Chưa tải được bản mới; giữ số liệu VCI đã lưu.</p>}
    {historical && <p className="quant-risk-note">Chỉ số doanh nghiệp là bản cập nhật hiện tại, không phải số liệu tại phiên lịch sử đang xem.</p>}</div>
  </article>
}
