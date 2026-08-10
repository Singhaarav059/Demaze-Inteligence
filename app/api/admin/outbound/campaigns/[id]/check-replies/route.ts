// ============================================================
// Admin: Check for Replies — POST /api/admin/outbound/campaigns/[id]/check-replies
// ============================================================
// Free, poll-on-demand reply detection for the Gmail sending provider —
// this app has no background scheduler anywhere (same as the Warm-Up
// module, which appends a fresh metrics snapshot only when its page is
// viewed), so this route is meant to be called when someone looks at the
// Campaigns page, not on a timer. Only meaningful for 'gmail': mock has
// nothing to poll, and a future real-time-webhook provider would report
// replies its own way instead of through this route.
//
// For each of this campaign's contacts that were actually sent (status
// 'sent' or a followup_N status — never 'queued', 'replied', 'bounced', or
// 'stopped') and have a provider_message_id (the Gmail THREAD id — see
// lib/outbound/sending/providers/gmail.ts's header comment for why it's the
// thread id, not the message id), fetches the thread's messages via Gmail's
// gmail.metadata-scoped read access and checks whether any message came
// from someone other than the connected account.
//
// Session 3 (suppression list) addition: every such message is now checked
// against looksLikeBounce() (gmail-client.ts) BEFORE being treated as a
// genuine prospect reply — an automated delivery-failure notification
// landing in the same thread used to be silently misfiled as a real reply
// (status -> 'replied', which is wrong and would have stopped follow-ups
// for the wrong reason without ever flagging the address as undeliverable).
// A detected bounce instead records a 'bounced' event, flips the contact to
// status 'bounced' (which already excludes it from every follow-up-eligible
// query, same as before this change), and adds the address to
// outbound_suppression_list so no FUTURE campaign ever emails it again
// either — a real reply still records 'replied' and flips status exactly as
// before.
//
// A found reply/bounce inserts one event (deduped by the message's own
// Gmail id via provider_event_id, the same idempotency mechanism migration
// 014 added for webhook-style retries).
//
// The actual per-contact loop lives in lib/outbound/sending/reply-check.ts
// (extracted 2026-08-05) so the automatic follow-up engine can run the exact
// same detection — this route is now just credential/token resolution +
// calling that function, unchanged behavior otherwise.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import { getGmailCredential, refreshAccessToken } from '@/lib/outbound/shared/gmail-client'
import { checkRepliesForCampaign } from '@/lib/outbound/sending/reply-check'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id: campaignId } = await params

  const activeProvider = await getActiveProviderName('sending')
  if (activeProvider !== 'gmail') {
    return NextResponse.json({
      success: true,
      checked: 0,
      newReplies: 0,
      message: `Reply checking only works with the Gmail sending provider (currently active: ${activeProvider}).`,
    })
  }

  const cred = await getGmailCredential()
  if (!cred) {
    return NextResponse.json({ success: false, error: 'No Gmail account connected.' }, { status: 400 })
  }

  const refreshed = await refreshAccessToken({
    clientId: cred.clientId,
    clientSecret: cred.clientSecret,
    refreshToken: cred.refreshToken,
  })
  if (!refreshed.ok) {
    return NextResponse.json({ success: false, error: refreshed.error }, { status: 502 })
  }

  const supabase = createServerClient()
  const summary = await checkRepliesForCampaign(supabase, campaignId, refreshed.accessToken, cred.email)

  return NextResponse.json({
    success: true,
    checked: summary.checked,
    newReplies: summary.newReplies,
    newBounces: summary.newBounces,
    errors: summary.errors.length > 0 ? summary.errors : undefined,
  })
}
