export type RadarMilestone = { date: string; kind: string }
export type RadarAssessment = { as_of_date: string; stage: string; entry_status: string;
  evidence?: { milestones?: RadarMilestone[] } | null }
export type FunnelAssessment = { stage: string }
export type MacdAssessment = { stage: string; trigger_date: string | null }
export type MacdLink = MacdAssessment & { evidence?: { trigger_age_sessions?: number | null } | null }
export type PublishedAction = { action: string }

export const radarMilestonesToday = (row: RadarAssessment) => row.evidence?.milestones?.filter(item => item.date === row.as_of_date) ?? []
export const hasRadarStageToday = (row: RadarAssessment, stage: string) => radarMilestonesToday(row).some(item => item.kind === stage)

export function isCurrentMacdLink(row: MacdLink, date: string) {
  return row.stage === 'WATCH_PRICE_CONFIRMATION'
    || row.stage === 'CONFIRMED' && (row.trigger_date === date
      || row.evidence?.trigger_age_sessions != null && row.evidence.trigger_age_sessions <= 5)
}

export function matchesRadarStage(row: RadarAssessment, filter: string) {
  if (filter === 'ALL') return true
  if (['DAILY_BREAKOUT', 'WEEKLY_CONFIRMED', 'REACCELERATING'].includes(filter)) return hasRadarStageToday(row, filter)
  return row.stage === filter
}

export function radarOpportunityPriority(row: RadarAssessment, champion: PublishedAction[],
  funnel?: FunnelAssessment, macd?: MacdAssessment) {
  if (champion.some(item => item.action === 'PROBE_BUY' || item.action === 'ADD')) return 0
  const fresh = hasRadarStageToday(row, 'DAILY_BREAKOUT') || hasRadarStageToday(row, 'WEEKLY_CONFIRMED')
    || funnel?.stage === 'DAILY_TRIGGER' || macd?.stage === 'CONFIRMED' && macd.trigger_date === row.as_of_date
  if (fresh && row.entry_status === 'RISK_WINDOW') return 1
  if (row.entry_status === 'EXTENDED') return 6
  if (fresh) return 2
  if (hasRadarStageToday(row, 'REACCELERATING') && row.entry_status === 'RISK_WINDOW') return 3
  if (funnel?.stage === 'WEEKLY_READY' || macd?.stage === 'WATCH_PRICE_CONFIRMATION') return 4
  if (['SURGE_WATCH', 'CONTINUING', 'REACCELERATING'].includes(row.stage)) return 5
  return row.stage === 'INVALIDATED' ? 7 : row.stage === 'DATA_CHECK' ? 8 : 9
}
