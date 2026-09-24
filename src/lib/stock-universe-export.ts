export type StockUniverseExportRow = {
  index: number
  symbol: string
  companyName: string
  sector: string
  exchange: string
}

const headers = ['STT', 'Mã chứng khoán', 'Tên công ty', 'Nhóm ngành', 'Sàn']

function downloadFile(contents: BlobPart, mimeType: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function rowsForExport(rows: StockUniverseExportRow[]) {
  return rows.map(row => [String(row.index), row.symbol, row.companyName, row.sector, row.exchange])
}

export function downloadUniverseCsv(rows: StockUniverseExportRow[]) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
  const csv = [headers, ...rowsForExport(rows)].map(row => row.map(quote).join(',')).join('\r\n')
  downloadFile(`\ufeff${csv}`, 'text/csv;charset=utf-8', 'prot-stock-danh-sach-co-phieu.csv')
}

function xmlEscape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function utf8(value: string) {
  return new TextEncoder().encode(value)
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function littleEndian(size: number, write: (view: DataView) => void) {
  const bytes = new Uint8Array(size)
  write(new DataView(bytes.buffer))
  return bytes
}

function zipStored(files: Array<{ name: string; content: string }>) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0

  for (const file of files) {
    const name = utf8(file.name)
    const content = utf8(file.content)
    const checksum = crc32(content)
    const localHeader = littleEndian(30, view => {
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true)
      view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0x0021, true)
      view.setUint32(14, checksum, true); view.setUint32(18, content.length, true); view.setUint32(22, content.length, true)
      view.setUint16(26, name.length, true); view.setUint16(28, 0, true)
    })
    localParts.push(localHeader, name, content)
    const centralHeader = littleEndian(46, view => {
      view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true)
      view.setUint16(8, 0x0800, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true); view.setUint16(14, 0x0021, true)
      view.setUint32(16, checksum, true); view.setUint32(20, content.length, true); view.setUint32(24, content.length, true)
      view.setUint16(28, name.length, true); view.setUint16(30, 0, true); view.setUint16(32, 0, true)
      view.setUint16(34, 0, true); view.setUint16(36, 0, true); view.setUint32(38, 0, true); view.setUint32(42, localOffset, true)
    })
    centralParts.push(centralHeader, name)
    localOffset += localHeader.length + name.length + content.length
  }

  const central = new Blob(centralParts as unknown as BlobPart[]).size
  const end = littleEndian(22, view => {
    view.setUint32(0, 0x06054b50, true); view.setUint16(4, 0, true); view.setUint16(6, 0, true)
    view.setUint16(8, files.length, true); view.setUint16(10, files.length, true)
    view.setUint32(12, central, true); view.setUint32(16, localOffset, true); view.setUint16(20, 0, true)
  })
  return new Blob([...localParts, ...centralParts, end] as unknown as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function downloadUniverseExcel(rows: StockUniverseExportRow[]) {
  const allRows = [headers, ...rowsForExport(rows)]
  const colNames = ['A', 'B', 'C', 'D', 'E']
  const sheetRows = allRows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = `${colNames[columnIndex]}${rowIndex + 1}`
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
  }).join('')}</row>`).join('')
  const files = [
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Danh sách cổ phiếu" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E${allRows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="48" customWidth="1"/><col min="4" max="4" width="26" customWidth="1"/><col min="5" max="5" width="14" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:E${allRows.length}"/></worksheet>` },
  ]
  downloadFile(zipStored(files), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'prot-stock-danh-sach-co-phieu.xlsx')
}

function ascii(value: string) {
  return new TextEncoder().encode(value)
}

function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function base64Bytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function pdfFromJpegPages(images: Uint8Array[]) {
  const objects: Uint8Array[] = []
  const pageObjectIds = images.map((_, index) => 3 + index * 3)
  objects.push(ascii('<< /Type /Catalog /Pages 2 0 R >>'))
  objects.push(ascii(`<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${images.length} >>`))

  images.forEach((image, index) => {
    const pageId = pageObjectIds[index]
    const contentId = pageId + 1
    const imageId = pageId + 2
    objects.push(ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`))
    const stream = ascii('q\n842 0 0 595 0 0 cm\n/Im0 Do\nQ\n')
    objects.push(concatBytes([ascii(`<< /Length ${stream.length} >>\nstream\n`), stream, ascii('endstream')]))
    objects.push(concatBytes([ascii(`<< /Type /XObject /Subtype /Image /Width 1800 /Height 1273 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, ascii('\nendstream')]))
  })

  const parts: Uint8Array[] = [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]
  const offsets = [0]
  let currentOffset = parts[0].length
  objects.forEach((object, index) => {
    const wrapped = concatBytes([ascii(`${index + 1} 0 obj\n`), object, ascii('\nendobj\n')])
    offsets.push(currentOffset)
    parts.push(wrapped)
    currentOffset += wrapped.length
  })
  const xrefOffset = currentOffset
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  parts.push(ascii(xref))
  return new Blob([concatBytes(parts)] as unknown as BlobPart[], { type: 'application/pdf' })
}

function renderPdfPage(rows: StockUniverseExportRow[], pageNumber: number, pageCount: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 1800
  canvas.height = 1273
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Không thể dựng trang PDF trên trình duyệt này.')
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#10251b'; context.font = '700 36px Inter, Arial, sans-serif'; context.fillText('Danh sách cổ phiếu Prot Stock', 72, 82)
  context.fillStyle = '#52665b'; context.font = '400 20px Inter, Arial, sans-serif'; context.fillText(`${rows.length} mã đang hoạt động · Sắp xếp A–Z · Trang ${pageNumber}/${pageCount}`, 72, 121)

  const x = [72, 148, 350, 1135, 1505]
  const widths = [76, 202, 785, 370, 223]
  let y = 164
  const rowHeight = 36
  context.fillStyle = '#eaf1eb'; context.fillRect(72, y, 1656, 44)
  context.fillStyle = '#183328'; context.font = '700 17px Inter, Arial, sans-serif'
  headers.forEach((header, index) => context.fillText(header, x[index] + 9, y + 28, widths[index] - 18))
  y += 44
  rows.forEach((row, rowIndex) => {
    if (rowIndex % 2 === 1) { context.fillStyle = '#f7faf7'; context.fillRect(72, y, 1656, rowHeight) }
    const values = [String(row.index), row.symbol, row.companyName, row.sector, row.exchange]
    context.fillStyle = '#20342a'; context.font = rowIndex % 2 === 0 ? '400 16px Inter, Arial, sans-serif' : '400 16px Inter, Arial, sans-serif'
    values.forEach((value, index) => context.fillText(value, x[index] + 9, y + 24, widths[index] - 18))
    context.strokeStyle = '#e3ebe4'; context.lineWidth = 1; context.beginPath(); context.moveTo(72, y + rowHeight); context.lineTo(1728, y + rowHeight); context.stroke()
    y += rowHeight
  })
  return base64Bytes(canvas.toDataURL('image/jpeg', 0.92).split(',')[1])
}

export async function downloadUniversePdf(rows: StockUniverseExportRow[]) {
  await document.fonts?.ready
  const rowsPerPage = 27
  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage))
  const images = Array.from({ length: pageCount }, (_, index) => renderPdfPage(rows.slice(index * rowsPerPage, (index + 1) * rowsPerPage), index + 1, pageCount))
  downloadFile(pdfFromJpegPages(images), 'application/pdf', 'prot-stock-danh-sach-co-phieu.pdf')
}
