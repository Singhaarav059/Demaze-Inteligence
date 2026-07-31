// ============================================================
// Admin: Outbound Overview — GET /api/admin/outbound/overview
// ============================================================
// Cross-campaign aggregate stats + a unified, filterable list of every
// outbound_campaign_contacts row (i.e. every email queued/sent across every
// campaign, not scoped to one campaign like /campaigns/[id]/contacts).
// Session 1 of the "Outreach Control Center" build — see CLAUDE.md/session
// history for the full planned scope (reply tracker, follow-up control,
// multi-mailbox, suppression list, rate limits come in later sessions).
//
// Stats are computed in JS from a single cheap, unjoined fetch of
// (status, campaign_id, updated_at) across all campaign_contacts — same
// "pure function over already-stored state" shape as
// lib/outbound/sending/followup-schedule.ts and lib/batch/quota-pause.ts
// elsewhere in this repo. This app has no analytics/warehouse table, and
// the row count here is small enough (test/demo campaigns) that a second
// query beats a hand-rolled SQL aggregate via the Supabase JS client, which
// has no native GROUP BY.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { isFollowupDue } from '@/lib/outbound/sending/followup-schedule'
import { getFollowupIntervals } from '@/lib/outbound/sending/followup-settings'

const SENT_ISH_STATUSES = ['sent', 'followup_1', 'followup_2', 'followup_3', 'replied', 'bounced', 'stopped']
const FOLLOWUP_ELIGIBLE_STATUSES = ['sent', 'followup_1', 'followup_2', 'followup_3']

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const supabase = createServerClient()
  const params = req.nextUrl.searchParams
  const statusFilter = params.get('status')
  const campaignId = params.get('campaign_id')
  const search = params.get('search')?.trim()
  const limit = Math.min(Number(params.get('limit')) || 50, 200)
  const offset = Number(params.get('offset')) || 0

  // --- Stats (unfiltered, always across every campaign) ---
  const { data: allContacts, error: statsError } = await supabase
    .from('outbound_campaign_contacts')
    .select('status, updated_at')

  if (statsError) {
    return NextResponse.json({ success: false, error: statsError.message }, { status: 500 })
  }

  const intervalsDays = await getFollowupIntervals()
  const byStatus: Record<string, number> = {}
  let followupDueNow = 0
  const now = new Date()
  for (const row of allContacts ?? []) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    if (FOLLOWUP_ELIGIBLE_STATUSES.includes(row.status) && isFollowupDue(row.status, row.updated_at, now, intervalsDays)) {
      followupDueNow += 1
    }
  }
  const totalContacted = SENT_ISH_STATUSES.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0)
  const replied = byStatus['replied'] ?? 0

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { count: sentLast24h } = await supabase
    .from('outbound_campaign_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'sent')
    .gte('occurred_at', dayAgo)

  const stats = {
    byStatus,
    queued: byStatus['queued'] ?? 0,
    totalContacted,
    replied,
    bounced: byStatus['bounced'] ?? 0,
    followupPending: (byStatus['followup_1'] ?? 0) + (byStatus['followup_2'] ?? 0) + (byStatus['followup_3'] ?? 0),
    followupDueNow,
    replyRate: totalContacted > 0 ? replied / totalContacted : 0,
    sentLast24h: sentLast24h ?? 0,
  }

  // --- Unified, filtered, paginated email list ---
  let query = supabase
    .from('outbound_campaign_contacts')
    .select(
      `id, campaign_id, contact_id, status, provider_message_id, created_at, updated_at,
       outbound_contacts(person_name, email, company_name, company_domain),
       outbound_campaigns(name, status, sender_provider),
       outbound_generated_content(selected_subject_line, status)`,
      { count: 'exact' }
    )
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (statusFilter) query = query.eq('status', statusFilter)
  if (campaignId) query = query.eq('campaign_id', campaignId)

  const { data: emails, error: listError, count } = await query

  if (listError) {
    return NextResponse.json({ success: false, error: listError.message }, { status: 500 })
  }

  // Search (person/company/email) is applied post-fetch against the joined
  // contact fields — Supabase's .or() ilike syntax can't reach across a
  // to-one embedded relation, and this table's real-world row count doesn't
  // justify a denormalized search column just for this filter.
  let filtered = emails ?? []
  if (search) {
    const needle = search.toLowerCase()
    filtered = filtered.filter(row => {
      const c = row.outbound_contacts as unknown as { person_name?: string; email?: string; company_name?: string } | null
      return (
        c?.person_name?.toLowerCase().includes(needle) ||
        c?.email?.toLowerCase().includes(needle) ||
        c?.company_name?.toLowerCase().includes(needle)
      )
    })
  }

  return NextResponse.json({
    success: true,
    stats,
    emails: filtered,
    total: search ? filtered.length : (count ?? filtered.length),
  })
}
