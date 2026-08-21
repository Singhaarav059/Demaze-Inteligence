// ============================================================
// Campaign Sending Safety — daily send limit + send window (migration 020)
// ============================================================
// Both checks are opt-in per campaign (NULL columns = unrestricted, same
// fail-safe-default convention as every other settings table in this app —
// see outbound_followup_settings, lib/outbound/settings/provider-selection.ts).
// Reused identically by the three real send paths: the manual "Send Queued"
// route, "Process Follow-ups", and the automatic follow-up engine tick — one
// place to get this right, not three copies.
//
// Timezone handling uses Intl.DateTimeFormat directly (no new dependency —
// Node ships full ICU) rather than a date library. currentHourInTimezone is
// exact. startOfDayInTimezone is accurate to within a DST-transition-exactly-
// at-local-midnight edge case (the correction uses the offset at `now`, not
// re-derived at the computed midnight instant) — an accepted approximation
// for a soft daily-volume guard, not a legal/billing boundary.
// ============================================================

import type { createServerClient } from '@/lib/supabase/server'

export interface CampaignSendLimits {
  daily_send_limit: number | null
  send_window_start: number | null
  send_window_end: number | null
  timezone: string | null
}

function currentHourInTimezone(date: Date, timeZone: string): number {
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(date)
    const hour = parseInt(hourStr, 10)
    return hour === 24 ? 0 : hour
  } catch {
    return date.getUTCHours() // invalid/unknown timeZone string — fall back to UTC rather than throwing
  }
}

function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value
    return acc
  }, {} as Record<string, string>)
  const asUtcMs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  )
  return (asUtcMs - date.getTime()) / 60000
}

function startOfDayInTimezone(date: Date, timeZone: string): Date {
  try {
    const offsetMin = getTimezoneOffsetMinutes(date, timeZone)
    const local = new Date(date.getTime() + offsetMin * 60000)
    const localMidnightAsUtcMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0)
    return new Date(localMidnightAsUtcMs - offsetMin * 60000)
  } catch {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0))
  }
}

// Returns true (unrestricted) when either bound is unset. Handles a window
// that wraps past midnight (e.g. start=22, end=6). A window where start
// equals end is treated as "no restriction" rather than "never send" — a
// zero-width window is far more likely to be an accidental config than an
// intentional permanent block, and this app has no separate "paused"-style
// UI affordance for that; pausing the campaign itself is the correct way to
// stop all sending.
export function isWithinSendWindow(campaign: CampaignSendLimits, now: Date = new Date()): boolean {
  const { send_window_start: start, send_window_end: end } = campaign
  if (start == null || end == null || start === end) return true
  const tz = campaign.timezone || 'UTC'
  const hour = currentHourInTimezone(now, tz)
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

// Infinity when dailyLimit is null (unrestricted) — callers can compare any
// real count against this without a separate null check.
export async function remainingDailySendCapacity(
  supabase: ReturnType<typeof createServerClient>,
  campaignId: string,
  dailyLimit: number | null,
  timezone: string | null,
  now: Date = new Date()
): Promise<number> {
  if (dailyLimit == null) return Infinity

  const startOfDay = startOfDayInTimezone(now, timezone || 'UTC')
  const { count, error } = await supabase
    .from('outbound_campaign_events')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('event_type', 'sent')
    .gte('occurred_at', startOfDay.toISOString())

  // A count-query failure fails OPEN (treat as "capacity available") rather
  // than silently blocking every send in the app on a transient read error.
  // Unlike lib/outbound/sending/suppression.ts's isSuppressed() (which now
  // fails closed per Pilot Readiness Plan Rule 6), a daily-cap read failure
  // isn't a safety/identity/suppression/dedup question — it's a soft
  // capacity throttle, so failing open here stays a deliberately different
  // call, not an inconsistency.
  if (error) return Infinity
  return Math.max(0, dailyLimit - (count ?? 0))
}
