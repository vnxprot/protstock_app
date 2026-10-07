import { SoftSelect } from './SoftSelect'

export function ResearchPagination({ label, page, pageSize, total, onPage, onPageSize }: {
  label: string; page: number; pageSize: number; total: number
  onPage: (page: number) => void; onPageSize: (size: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pages)
  return <nav className="screener-pagination" aria-label={label}>
    <span>Hiển thị <SoftSelect aria-label="Số dòng mỗi trang" value={pageSize} onChange={event => onPageSize(Number(event.target.value))}><option value="25">25</option><option value="50">50</option><option value="100">100</option></SoftSelect> / trang · {total} kết quả</span>
    <div><button type="button" disabled={current === 1} onClick={() => onPage(1)}>Đầu</button>
      <button type="button" disabled={current === 1} onClick={() => onPage(current - 1)}>‹ Trước</button>
      <b>Trang {current}/{pages}</b>
      <button type="button" disabled={current === pages} onClick={() => onPage(current + 1)}>Sau ›</button>
      <button type="button" disabled={current === pages} onClick={() => onPage(pages)}>Cuối</button></div>
  </nav>
}
