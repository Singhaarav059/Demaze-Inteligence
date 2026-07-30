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
// For each of this campaign's contacts sitting at 'sent'/'followup_1'/
// 'followup_2' (i.e. still owed a follow-up, per
// lib/outbound/sending/followup-schedule.ts's cadence) whose next follow-up
// is due: if the active sending provider is Gmail and a thread id is on
// file, checks that thread for a reply FIRST — a reply found here means
// this contact is done, no follow-up gets sent (reply-triggered
// cancellation), same idempotent 'replied' event/status flip as
// check-replies/route.ts. Otherwise sends the next follow-up in the
// contact's generated sequence (outbound_generated_content.followups),
// threaded into the original Gmail conversation when possible (see
// gmail-client.ts's sendGmailMessage), advances status to 'followup_N', and
// records a 'sent' event tagged with followupSequence in its detail.
//
// A contact missing generated follow-up content for the next sequence, or
// missing an email, is skipped (left at its current status, eligible for
// retry next time this route runs) — never silently marked done, same
// discipline as send/route.ts.
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
  getLastMessageIdHeader,
} from '@/lib/outbound/shared/gmail-client'
import { sendEmail } from '@/lib/outbound/sending/provider-factory'
import { nextFollowupSequence, isFollowupDue, buildFollowupSubject } from '@/lib/outbound/sending/followup-schedule'

const ELIGIBLE_STATUSES = ['sent', 'followup_1', 'followup_2']

interface FollowupOutcome {
  campaignContactId: string
  status: 'sent' | 'not_due' | 'cancelled_reply' | 'skipped' | 'failed'
  sequence?: number
  reason?: string
}

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

  // Reply-triggered cancellation only works for Gmail (the only provider
  // with a thread to poll) — for any other active provider, follow-ups
  // still send on schedule, just without the extra reply check. Refreshed
  // once up front, same as check-replies/route.ts, not per contact.
  const activeProvider = await getActiveProviderName('sending')
  let gmailAccessToken: string | null = null
  let gmailConnectedEmail: string | undefined
  if (activeProvider === 'gmail') {
    const cred = await getGmailCredential()
    if (cred) {
      const refreshed = await refreshAccessToken({
        clientId: cred.clientId,
        clientSecret: cred.clientSecret,
        refreshToken: cred.refreshToken,
      })
      if (refreshed.ok) {
        gmailAccessToken = refreshed.accessToken
        gmailConnectedEmail = cred.email
      }
    }
  }

  const { data: contacts, error: fetchError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id, contact_id, status, provider_message_id, updated_at')
    .eq('campaign_id', campaignId)
    .in('status', ELIGIBLE_STATUSES)

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }

  const outcomes: FollowupOutcome[] = []

  for (const cc of contacts ?? []) {
    const sequence = nextFollowupSequence(cc.status)
    if (sequence === null) continue // shouldn't happen given the query filter, but defensive

    if (!isFollowupDue(cc.status, cc.updated_at)) {
      outcomes.push({ campaignContactId: cc.id, status: 'not_due', sequence })
      continue
    }

    let inReplyTo: string | undefined

    if (gmailAccessToken && cc.provider_message_id) {
      const thread = await getGmailThread(cc.provider_message_id, gmailAccessToken)
      if (!thread.ok) {
        outcomes.push({ campaignContactId: cc.id, status: 'skipped', sequence, reason: `Could not verify reply status: ${thread.error}` })
        continue
      }

      const reply = gmailConnectedEmail
        ? findReplyInThread(thread.messages, gmailConnectedEmail)
        : { hasReply: false as const }

      if (reply.hasReply) {
        if (reply.replyMessageId) {
          const { data: existing } = await supabase
            .from('outbound_campaign_events')
            .select('id')
            .eq('provider_event_id', reply.replyMessageId)
            .maybeSingle()
          if (!existing) {
            const { error: insertError } = await supabase.from('outbound_campaign_events').insert({
              campaign_id: campaignId,
              campaign_contact_id: cc.id,
              event_type: 'replied',
              provider_event_id: reply.replyMessageId,
              detail: { source: 'gmail_poll_before_followup', threadId: cc.provider_message_id, fromHeader: reply.fromHeader },
            })
            if (!insertError) {
              await supabase
                .from('outbound_campaign_contacts')
                .update({ status: 'replied', updated_at: new Date().toISOString() })
                .eq('id', cc.id)
            }
          }
        }
        outcomes.push({ campaignContactId: cc.id, status: 'cancelled_reply', sequence, reason: 'Prospect replied — follow-up cancelled.' })
        continue
      }

      inReplyTo = getLastMessageIdHeader(thread.messages)
    }

    const { data: contact } = await supabase
      .from('outbound_contacts')
      .select('email')
      .eq('id', cc.contact_id)
      .maybeSingle()

    if (!contact?.email) {
      outcomes.push({ campaignContactId: cc.id, status: 'skipped', sequence, reason: 'Contact has no email.' })
      continue
    }

    const { data: generated } = await supabase
      .from('outbound_generated_content')
      .select('selected_subject_line, followups')
      .eq('contact_id', cc.contact_id)
      .maybeSingle()

    const followups = (generated?.followups ?? []) as Array<{ sequence: number; body: string }>
    const draft = followups.find(f => f.sequence === sequence)

    if (!generated?.selected_subject_line || !draft?.body) {
      outcomes.push({ campaignContactId: cc.id, status: 'skipped', sequence, reason: `No generated follow-up ${sequence} content for this contact yet.` })
      continue
    }

    const result = await sendEmail({
      campaignId,
      contactEmail: contact.email,
      subject: buildFollowupSubject(generated.selected_subject_line),
      body: draft.body,
      threadId: cc.provider_message_id ?? undefined,
      inReplyTo,
    })

    if (result.status === 'failed') {
      outcomes.push({ campaignContactId: cc.id, status: 'failed', sequence, reason: result.error })
      continue
    }

    await supabase
      .from('outbound_campaign_contacts')
      .update({ status: `followup_${sequence}`, updated_at: new Date().toISOString() })
      .eq('id', cc.id)

    await supabase.from('outbound_campaign_events').insert({
      campaign_id: campaignId,
      campaign_contact_id: cc.id,
      event_type: 'sent',
      detail: {
        followupSequence: sequence,
        providerMessageId: result.providerMessageId,
        providerUsed: result.providerUsed,
        providerStatus: result.status,
      },
    })

    outcomes.push({ campaignContactId: cc.id, status: 'sent', sequence })
  }

  return NextResponse.json({
    success: true,
    checked: contacts?.length ?? 0,
    sent: outcomes.filter(o => o.status === 'sent').length,
    cancelledByReply: outcomes.filter(o => o.status === 'cancelled_reply').length,
    notDue: outcomes.filter(o => o.status === 'not_due').length,
    skipped: outcomes.filter(o => o.status === 'skipped').length,
    failed: outcomes.filter(o => o.status === 'failed').length,
    outcomes,
  })
}
