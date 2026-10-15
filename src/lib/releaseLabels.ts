// Presentation labels only. Persisted engine names and revision IDs remain intact
// so historical signals, EOD publication joins, and backtests stay reproducible.
export const STRUCTURE_VERSION = 'v0.0.0'

const coreEngineLabels: Record<string, string> = {
  'Prot Core Engine v0.0': 'Prot Core Engine · Mẫu hình v0.0.0',
  'Prot Core Engine v1.0': 'Prot Core Engine · Nền tảng v0.0.0',
  'Prot Core Engine v2.0': 'Prot Core Engine · Đa khung v0.0.0',
}

export function displayStructureName(name: string): string {
  if (coreEngineLabels[name]) return coreEngineLabels[name]
  if (name.startsWith('Prot Core Pack')) {
    const clean = name.replace(/\s+v\d+(?:\.\d+){1,2}\b/gi, '')
    return `${clean} ${STRUCTURE_VERSION}`
  }
  return name
}

export function displaySystemRevision(revision?: string | null): string {
  if (!revision) return 'Chưa ghi phiên bản'
  return /^core-rules-v0\.0\.0(?:-trend1)?$|^health-v0\.0\.0$|^MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0$/i.test(revision)
    ? STRUCTURE_VERSION
    : revision
}
