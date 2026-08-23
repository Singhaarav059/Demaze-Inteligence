// ============================================================
// Admin: Outbound Activity — GET /api/admin/outbound/overview/activity
// ============================================================
// Real, timestamped event data for the Overview page's "sends over time"
// sparkline (redesign brief Section 24 — charts only use real data).
// Returns raw occurred_at timestamps for 'sent' events in the trailing 14
// days, bounded server-side by a date filter; bucketing/sufficiency-gating
// happens client-side via the shared, unit-tested
// lib/analytics/daily-counts.ts helpers — same "return raw, aggregate in
// JS" convention already used by /api/admin/outbound/overview's own stats
// query (this app has no analytics/warehouse table).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

const WINDOW_DAYS = 14

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const supabase = createServerClient()
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('outbound_campaign_events')
    .select('occurred_at')
    .eq('event_type', 'sent')
    .gte('occurred_at', since)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    windowDays: WINDOW_DAYS,
    sentTimestamps: (data ?? []).map(r => r.occurred_at),
  })
}
