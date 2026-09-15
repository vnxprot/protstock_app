import { formatDate } from './date'

export type SignalExportRow = {
  symbol: string; sector: string | null; action: string; timeframe: string; score: number
  confluenceCount: number; date: string; engines: string; reasons: string
}

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
const stamp = () => new Date().toISOString().slice(0, 10)
const rowsFor = (rows: SignalExportRow[]) => rows.map(row => [row.symbol, row.sector ?? '', row.action, row.timeframe, row.score, row.confluenceCount, formatDate(row.date), row.engines, row.reasons])
const headers = ['Mã', 'Ngành', 'Hành động', 'Khung', 'Điểm', 'Số bộ máy', 'Ngày', 'Bộ máy tín hiệu', 'Lý do']

export function downloadSignalCsv(rows: SignalExportRow[]) {
  const cell = (value: unknown) => { const text = value == null ? '' : String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }
  const csv = [headers, ...rowsFor(rows)].map(row => row.map(cell).join(',')).join('\r\n')
  download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `prot-stock-tin-hieu-${stamp()}.csv`)
}

export async function downloadSignalExcel(rows: SignalExportRow[]) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rowsFor(rows)])
  sheet['!cols'] = [{ wch: 10 }, { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 42 }, { wch: 68 }]
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Tin hieu')
  XLSX.writeFile(book, `prot-stock-tin-hieu-${stamp()}.xlsx`, { compression: true })
}

export async function downloadSignalPdf(rows: SignalExportRow[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('PROT STOCK · CONSOLIDATED SIGNALS', 12, 14)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(`Exported: ${stamp()} · ${rows.length} signals`, 12, 20)
  autoTable(doc, { startY: 25, head: [headers], body: rowsFor(rows), theme: 'striped', styles: { font: 'helvetica', fontSize: 6.5, cellPadding: 1.5 }, headStyles: { fillColor: [20, 55, 41] } })
  doc.save(`prot-stock-tin-hieu-${stamp()}.pdf`)
}
