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
// from someone other than the connected account. A found reply inserts one
// 'replied' event (deduped by the reply message's own Gmail id via
// provider_event_id, the same idempotency mechanism migration 014 added for
// webhook-style retries) and flips that contact to status 'replied'.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import {
  getGmailCredential,
  refreshAccessToken,
  getGmailThread,
  findReplyInThread,
} from '@/lib/outbound/shared/gmail-client'

const SENT_STATUSES = ['sent', 'followup_1', 'followup_2', 'followup_3']

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

  const { data: contacts, error: fetchError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id, provider_message_id')
    .eq('campaign_id', campaignId)
    .in('status', SENT_STATUSES)
    .not('provider_message_id', 'is', null)

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }

  let newReplies = 0
  const errors: string[] = []

  for (const contact of contacts ?? []) {
    const threadId = contact.provider_message_id as string
    const thread = await getGmailThread(threadId, refreshed.accessToken)
    if (!thread.ok) continue // one bad thread lookup shouldn't abort the whole batch

    const reply = cred.email
      ? findReplyInThread(thread.messages, cred.email)
      : thread.messages.length > 1
        ? { hasReply: true, replyMessageId: thread.messages[thread.messages.length - 1].id }
        : { hasReply: false }

    if (!reply.hasReply) continue

    if (reply.replyMessageId) {
      const { data: existing } = await supabase
        .from('outbound_campaign_events')
        .select('id')
        .eq('provider_event_id', reply.replyMessageId)
        .maybeSingle()
      if (existing) continue // already recorded on a previous check
    }

    // FIXED (2026-07-29): this insert's error used to be silently discarded
    // — a contact could get flipped to 'replied' below with no
    // corresponding event ever recorded (exactly what happened live: a
    // not-yet-applied migration 014 meant provider_event_id didn't exist
    // yet, the insert failed with a schema-cache error, and nothing
    // surfaced it). Now the status flip is skipped and the failure is
    // reported in the response if the event can't be recorded — same
    // "don't silently continue past a write you can't verify" discipline
    // this repo's other silent-failure fixes already established.
    const { error: insertError } = await supabase.from('outbound_campaign_events').insert({
      campaign_id: campaignId,
      campaign_contact_id: contact.id,
      event_type: 'replied',
      provider_event_id: reply.replyMessageId ?? null,
      detail: { source: 'gmail_poll', threadId, fromHeader: 'fromHeader' in reply ? reply.fromHeader : undefined },
    })

    if (insertError) {
      errors.push(`contact ${contact.id}: failed to record reply event — ${insertError.message}`)
      continue
    }

    const { error: updateError } = await supabase
      .from('outbound_campaign_contacts')
      .update({ status: 'replied', updated_at: new Date().toISOString() })
      .eq('id', contact.id)

    if (updateError) {
      errors.push(`contact ${contact.id}: event recorded but status update failed — ${updateError.message}`)
      continue
    }

    newReplies += 1
  }

  return NextResponse.json({
    success: true,
    checked: contacts?.length ?? 0,
    newReplies,
    errors: errors.length > 0 ? errors : undefined,
  })
}
