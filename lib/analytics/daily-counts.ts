// ============================================================
// Day-bucketing + "is there enough real data to chart this" gate
// ============================================================
// Shared by every sparkline in the admin product. Per this repo's standing
// chart rule (CLAUDE.md, Section 24 of the redesign brief): charts only use
// real data, and a chart backed by 1-2 real points is worse than no chart.
// hasSufficientTrendData() is the single gate every chart-rendering call
// site must check before rendering — a page/route should never invent its
// own threshold.
// ============================================================

export interface DailyCount {
  date: string // YYYY-MM-DD, UTC
  count: number
}

/**
 * Buckets ISO timestamps into UTC-day counts for the trailing `days` days
 * (inclusive of `now`'s day), zero-filling days with no activity so the
 * returned series always has exactly `days` points in chronological order.
 * Invalid/missing timestamps are silently skipped (not counted, not thrown).
 */
export function computeDailyCounts(
  timestamps: (string | null | undefined)[],
  days: number,
  now: Date = new Date()
): DailyCount[] {
  const buckets = new Map<string, number>()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    buckets.set(d.toISOString().slice(0, 10), 0)
  }
  for (const ts of timestamps) {
    if (!ts) continue
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) continue
    const key = d.toISOString().slice(0, 10)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }))
}

// Deliberately conservative thresholds, not tuned to any one account's real
// volume — a chart showing e.g. 1 real event spread across 14 empty days
// reads as broken/fake, not informative. Both conditions must hold: enough
// total activity, AND that activity spread across enough distinct days
// (guards against one busy day masquerading as a "trend").
export const MIN_TREND_TOTAL = 5
export const MIN_TREND_ACTIVE_DAYS = 3

export function hasSufficientTrendData(buckets: DailyCount[]): boolean {
  const total = buckets.reduce((sum, b) => sum + b.count, 0)
  const activeDays = buckets.filter(b => b.count > 0).length
  return total >= MIN_TREND_TOTAL && activeDays >= MIN_TREND_ACTIVE_DAYS
}
