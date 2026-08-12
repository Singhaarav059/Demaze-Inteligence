// ============================================================
// Follow-Up Cadence Settings — reads/writes outbound_followup_settings
// ============================================================
// A single admin-editable row (id=1) holding the 3 per-step intervals that
// followup-schedule.ts's FOLLOWUP_INTERVALS_DAYS used to hardcode. Same
// "any failure just falls back to the safe default" discipline as
// lib/outbound/settings/provider-selection.ts — this covers both "Supabase
// isn't configured" and "migration 016 hasn't been applied yet" (a missing
// table produces a Postgres error here, not a thrown exception from the JS
// client, so the broad catch handles it the same way either way).
//
// getFollowupIntervals(campaignId?) (migration 020, Campaign Settings):
// when a campaignId is given, this first checks that campaign's own
// interval_1/2/3_days override columns — ONLY when all three are set (a
// partial override would be ambiguous: which step falls back to global and
// which doesn't?) — before falling back to the global singleton below. This
// keeps every existing call site (which passes no campaignId) byte-for-byte
// unchanged, and keeps a campaign with no override behaving exactly as
// before migration 020 shipped.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { FOLLOWUP_INTERVALS_DAYS } from './followup-schedule'

async function getGlobalFollowupIntervals(): Promise<readonly [number, number, number]> {
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('outbound_followup_settings')
      .select('interval_1_days, interval_2_days, interval_3_days')
      .eq('id', 1)
      .maybeSingle()

    if (!data) return FOLLOWUP_INTERVALS_DAYS
    return [data.interval_1_days, data.interval_2_days, data.interval_3_days]
  } catch {
    return FOLLOWUP_INTERVALS_DAYS
  }
}

export async function getFollowupIntervals(campaignId?: string): Promise<readonly [number, number, number]> {
  if (!campaignId) return getGlobalFollowupIntervals()

  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('outbound_campaigns')
      .select('interval_1_days, interval_2_days, interval_3_days')
      .eq('id', campaignId)
      .maybeSingle()

    if (data && data.interval_1_days != null && data.interval_2_days != null && data.interval_3_days != null) {
      return [data.interval_1_days, data.interval_2_days, data.interval_3_days]
    }
  } catch {
    // Falls through to the global default below — same fail-open discipline
    // as every other lookup in this file.
  }
  return getGlobalFollowupIntervals()
}

export async function updateFollowupIntervals(
  intervals: readonly [number, number, number]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (intervals.some(n => !Number.isInteger(n) || n < 1 || n > 365)) {
    return { ok: false, error: 'Each interval must be a whole number of days between 1 and 365.' }
  }
  try {
    const supabase = createServerClient()
    const { error } = await supabase
      .from('outbound_followup_settings')
      .upsert({
        id: 1,
        interval_1_days: intervals[0],
        interval_2_days: intervals[1],
        interval_3_days: intervals[2],
        updated_at: new Date().toISOString(),
      })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save cadence settings.' }
  }
}
