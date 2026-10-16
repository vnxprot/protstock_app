export type JournalSignalEvidence = { timeframe: string; action: string; state: string; score: number; reasons: string[] }
export type JournalEvidenceSnapshot = { as_of_date: string | null; source_revision: string | null; captured_at: string; signals: JournalSignalEvidence[]; baseline?: {date:string;close:number;revision:string;basis:string}|null; engines?: Array<{name:string;version:string|number;rule_version_id:string;signal:Record<string,unknown>}>; challenger?: Record<string,any>[]; funnel?: Record<string,any>[]; radar?: Record<string,any>[]; macd?: Record<string,any>[] }
export function journalContext(
  previous: { evidence_snapshot: JournalEvidenceSnapshot | null; thesis_version_id: string | null } | null,
  snapshot: JournalEvidenceSnapshot,
  thesisVersionId: string | null,
) {
  return previous ? { evidence_snapshot: previous.evidence_snapshot, thesis_version_id: previous.thesis_version_id }
    : { evidence_snapshot: structuredClone(snapshot), thesis_version_id: thesisVersionId }
}
export function withEmotionTag(lesson: string | null | undefined, emotion: string) {
  const text = (lesson ?? '').replace(/\[emotion:\w+\]/g, '').trim()
  return (text ? text + '\n' : '') + '[emotion:' + emotion + ']'
}
