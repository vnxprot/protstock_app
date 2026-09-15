
export type PortfolioReportPosition = {
  symbol: string
  sector: string
  quantity: number
  averageCost: number
  marketPrice: number | null
  marketValue: number
  profitLoss: number
  returnPct: number | null
  weightPct: number
}

export type PortfolioReportData = {
  asOfDate: string | null
  capital: number
  cash: number
  marketValue: number
  netAssetValue: number
  profitLoss: number
  returnPct: number | null
  todayProfitLoss: number | null
  todayReturnPct: number | null
  averageNetAssets: number | null
  positions: PortfolioReportPosition[]
}

const reportDate = (value: string | null) => (value ?? new Date().toISOString().slice(0, 10)).split('-').reverse().join('.')
const ascii = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
const money = (value: number) => `${Math.round(value).toLocaleString('vi-VN')} VND`
const percent = (value: number | null) => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function downloadPortfolioExcel(data: PortfolioReportData) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  const summary = [
    ['PROT STOCK · BAO CAO DANH MUC'],
    ['Ngay du lieu', reportDate(data.asOfDate)],
    [],
    ['Chi tieu', 'Gia tri (VND)', 'Ty le'],
    ['Tong von', data.capital, 1],
    ['Tien mat uoc tinh', data.cash, data.capital ? data.cash / data.capital : null],
    ['Gia tri thi truong', data.marketValue, data.capital ? data.marketValue / data.capital : null],
    ['Tai san rong', data.netAssetValue, data.capital ? data.netAssetValue / data.capital : null],
    ['Loi nhuan / lo', data.profitLoss, data.returnPct == null ? null : data.returnPct / 100],
    ['Lai / lo hom nay', data.todayProfitLoss, data.todayReturnPct == null ? null : data.todayReturnPct / 100],
    ['Tai san rong binh quan (uoc tinh)', data.averageNetAssets, null],
  ]
  const positionRows = data.positions.map(item => ({
    'Mã': item.symbol,
    'Ngành': item.sector,
    'Khối lượng (CP)': item.quantity,
    'Giá vốn (VND)': item.averageCost,
    'Giá thị trường (VND)': item.marketPrice,
    'Giá trị thị trường (VND)': item.marketValue,
    'Lãi / lỗ (VND)': item.profitLoss,
    'Tỷ suất lợi nhuận': item.returnPct == null ? null : item.returnPct / 100,
    'Tỷ trọng NAV': item.weightPct / 100,
  }))
  const overview = XLSX.utils.aoa_to_sheet(summary)
  const positions = XLSX.utils.json_to_sheet(positionRows)
  overview['!cols'] = [{ wch: 34 }, { wch: 22 }, { wch: 15 }]
  positions['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 16 }, { wch: 19 }, { wch: 23 }, { wch: 25 }, { wch: 19 }, { wch: 19 }, { wch: 15 }]
  XLSX.utils.book_append_sheet(workbook, overview, 'Tong quan')
  XLSX.utils.book_append_sheet(workbook, positions, 'Co cau')
  XLSX.writeFile(workbook, `prot-stock-danh-muc-${reportDate(data.asOfDate)}.xlsx`, { compression: true })
}

export async function downloadPortfolioPdf(data: PortfolioReportData) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('PROT STOCK · PORTFOLIO OVERVIEW', 14, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`As of: ${reportDate(data.asOfDate)}`, 14, 23)
  autoTable(doc, {
    startY: 29,
    theme: 'grid',
    head: [['Metric', 'Value']],
    body: [
      ['Total capital', money(data.capital)],
      ['Cash estimate', money(data.cash)],
      ['Market value', money(data.marketValue)],
      ['Net asset value', money(data.netAssetValue)],
      ['Profit / Loss', `${money(data.profitLoss)} · ${percent(data.returnPct)}`],
      ['Today P/L', `${data.todayProfitLoss == null ? '—' : money(data.todayProfitLoss)} · ${percent(data.todayReturnPct)}`],
      ['Average net assets (estimate)', data.averageNetAssets == null ? '—' : money(data.averageNetAssets)],
    ],
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [20, 55, 41] },
  })
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 8,
    theme: 'striped',
    head: [['Symbol', 'Sector', 'Qty', 'Cost', 'Market value', 'P/L', 'Weight']],
    body: data.positions.map(item => [
      item.symbol,
      ascii(item.sector || 'Other'),
      item.quantity.toLocaleString('en-US'),
      money(item.averageCost),
      money(item.marketValue),
      money(item.profitLoss),
      `${item.weightPct.toFixed(1)}%`,
    ]),
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.6 },
    headStyles: { fillColor: [20, 55, 41] },
  })
  doc.save(`prot-stock-danh-muc-${reportDate(data.asOfDate)}.pdf`)
}
