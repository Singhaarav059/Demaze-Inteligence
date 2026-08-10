// ============================================================
// Admin: Process Due Follow-Ups — POST /api/admin/outbound/campaigns/[id]/process-followups
// ============================================================
// On-demand only — this app has no background scheduler anywhere (same
// constraint documented in check-replies/route.ts and the Warm-Up module),
// so this route is meant to be called when someone looks at the Campaigns
// page (a button, same UX as "Check for Replies"), not on a timer. Real
// "send this automatically at 9am in 3 days" scheduling would need a
// persistent job queue this app doesn't have; what this gives instead is
// "compute what's due right now and send it, whenever someone asks" — the
// same on-demand precedent as reply checking and Warm-Up's metrics.
//
// The actual per-contact logic (reply-check-first, then send-or-skip, then
// advance status) now lives in lib/outbound/sending/process-followup.ts
// (Session 2, Follow-up Control Panel) — shared with the new single-contact
// "Send Now" action on the Follow-up Control Panel, which needs the exact
// same logic minus the isFollowupDue gate (force=true).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getFollowupIntervals } from '@/lib/outbound/sending/followup-settings'
import {
  processFollowupForContact,
  resolveGmailContext,
  FOLLOWUP_ELIGIBLE_STATUSES,
  type FollowupOutcome,
} from '@/lib/outbound/sending/process-followup'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id: campaignId } = await params
  const supabase = createServerClient()

  const { data: campaign, error: campaignError } = await supabase
    .from('outbound_campaigns')
    .select('status')
    .eq('id', campaignId)
    .maybeSingle()

  if (campaignError) {
    return NextResponse.json({ success: false, error: campaignError.message }, { status: 500 })
  }
  if (!campaign) {
    return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
  }
  if (campaign.status === 'paused') {
    return NextResponse.json({ success: true, processed: 0, message: 'Campaign is paused — no follow-ups sent.' })
  }

  // Resolved once up front, same as check-replies/route.ts, not per contact.
  const gmail = await resolveGmailContext()
  const intervalsDays = await getFollowupIntervals()

  const { data: contacts, error: fetchError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id')
    .eq('campaign_id', campaignId)
    .in('status', FOLLOWUP_ELIGIBLE_STATUSES)

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }

  const outcomes: FollowupOutcome[] = []
  for (const cc of contacts ?? []) {
    const outcome = await processFollowupForContact(supabase, campaignId, cc.id, gmail, intervalsDays, false)
    outcomes.push(outcome)
  }

  return NextResponse.json({
    success: true,
    checked: contacts?.length ?? 0,
    sent: outcomes.filter(o => o.status === 'sent').length,
    cancelledByReply: outcomes.filter(o => o.status === 'cancelled_reply').length,
    cancelledByBounce: outcomes.filter(o => o.status === 'cancelled_bounce').length,
    notDue: outcomes.filter(o => o.status === 'not_due').length,
    skipped: outcomes.filter(o => o.status === 'skipped').length,
    failed: outcomes.filter(o => o.status === 'failed').length,
    outcomes,
  })
}
