// ============================================================
// Process One Follow-Up — shared by the bulk and single-contact routes
// ============================================================
// Extracted from app/api/admin/outbound/campaigns/[id]/process-followups/
// route.ts (Session 2, Follow-up Control Panel) so the same reply-check +
// send + status-advance logic isn't duplicated between "process every due
// follow-up in a campaign" (process-followups/route.ts, force=false, only
// acts when isFollowupDue) and "send this one contact's follow-up right now
// regardless of schedule" (followups/[id]/send-now/route.ts, force=true).
//
// Gmail credentials/access token are resolved ONCE by the caller (a whole
// campaign's worth of contacts share one OAuth refresh, same discipline
// check-replies/route.ts already used) and passed in, not re-fetched per
// contact.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import {
  getGmailCredential,
  refreshAccessToken,
  getGmailThread,
  findReplyInThread,
  getLastMessageIdHeader,
  looksLikeBounce,
} from '@/lib/outbound/shared/gmail-client'
import { sendEmail } from './provider-factory'
import { addToSuppressionList } from './suppression'
import { nextFollowupSequence, isFollowupDue, buildFollowupSubject } from './followup-schedule'

export interface FollowupOutcome {
  campaignContactId: string
  status: 'sent' | 'not_due' | 'cancelled_reply' | 'cancelled_bounce' | 'skipped' | 'failed'
  sequence?: number
  reason?: string
}

export interface FollowupGmailContext {
  accessToken: string | null
  connectedEmail?: string
}

// Reply-triggered cancellation only works for Gmail (the only provider with
// a thread to poll) — for any other active provider this resolves to a
// no-token context, and processFollowupForContact just skips the reply
// check. Shared by process-followups/route.ts (bulk) and
// followups/[id]/send-now/route.ts (single-contact) so the credential
// resolve + refresh only needs to be written once.
export async function resolveGmailContext(): Promise<FollowupGmailContext> {
  const activeProvider = await getActiveProviderName('sending')
  if (activeProvider !== 'gmail') return { accessToken: null }

  const cred = await getGmailCredential()
  if (!cred) return { accessToken: null }

  const refreshed = await refreshAccessToken({
    clientId: cred.clientId,
    clientSecret: cred.clientSecret,
    refreshToken: cred.refreshToken,
  })
  if (!refreshed.ok) return { accessToken: null }

  return { accessToken: refreshed.accessToken, connectedEmail: cred.email }
}

export async function processFollowupForContact(
  supabase: ReturnType<typeof createServerClient>,
  campaignId: string,
  campaignContactId: string,
  gmail: FollowupGmailContext,
  intervalsDays: readonly [number, number, number],
  force = false
): Promise<FollowupOutcome> {
  const { data: cc, error: fetchError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id, contact_id, status, provider_message_id, updated_at')
    .eq('id', campaignContactId)
    .eq('campaign_id', campaignId)
    .maybeSingle()

  if (fetchError || !cc) {
    return { campaignContactId, status: 'skipped', reason: fetchError?.message ?? 'Contact not found in this campaign.' }
  }

  const sequence = nextFollowupSequence(cc.status)
  if (sequence === null) {
    return { campaignContactId, status: 'skipped', reason: `No follow-up left to send for status "${cc.status}".` }
  }

  if (!force && !isFollowupDue(cc.status, cc.updated_at, new Date(), intervalsDays)) {
    return { campaignContactId, status: 'not_due', sequence }
  }

  let inReplyTo: string | undefined

  if (gmail.accessToken && cc.provider_message_id) {
    const thread = await getGmailThread(cc.provider_message_id, gmail.accessToken)
    if (!thread.ok) {
      return { campaignContactId, status: 'skipped', sequence, reason: `Could not verify reply status: ${thread.error}` }
    }

    const reply = gmail.connectedEmail
      ? findReplyInThread(thread.messages, gmail.connectedEmail)
      : { hasReply: false as const }

    if (reply.hasReply) {
      const replyMessage = thread.messages.find(m => m.id === reply.replyMessageId)
      const isBounce = replyMessage ? looksLikeBounce(replyMessage) : false

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
            event_type: isBounce ? 'bounced' : 'replied',
            provider_event_id: reply.replyMessageId,
            detail: { source: 'gmail_poll_before_followup', threadId: cc.provider_message_id, fromHeader: reply.fromHeader },
          })
          if (!insertError) {
            await supabase
              .from('outbound_campaign_contacts')
              .update({ status: isBounce ? 'bounced' : 'replied', updated_at: new Date().toISOString() })
              .eq('id', cc.id)
          }
        }
      }

      // Same reason a bounce mid-sequence must suppress future sends as a
      // fresh bounce found by check-replies/route.ts — this contact was
      // about to receive a follow-up when the bounce was discovered, so
      // there's no separate "found it via check-replies first" path this
      // could otherwise rely on.
      if (isBounce) {
        const { data: bouncedContact } = await supabase
          .from('outbound_contacts')
          .select('email')
          .eq('id', cc.contact_id)
          .maybeSingle()
        if (bouncedContact?.email) {
          await addToSuppressionList({
            email: bouncedContact.email,
            reason: 'bounced',
            detail: reply.fromHeader ? `Gmail bounce notice from: ${reply.fromHeader}` : 'Gmail bounce detected before sending a follow-up.',
            contactId: cc.contact_id,
            campaignId,
          })
        }
        return { campaignContactId, status: 'cancelled_bounce', sequence, reason: 'Delivery bounced — follow-up cancelled and address suppressed.' }
      }

      return { campaignContactId, status: 'cancelled_reply', sequence, reason: 'Prospect replied — follow-up cancelled.' }
    }

    inReplyTo = getLastMessageIdHeader(thread.messages)
  }

  const { data: contact } = await supabase
    .from('outbound_contacts')
    .select('email')
    .eq('id', cc.contact_id)
    .maybeSingle()

  if (!contact?.email) {
    return { campaignContactId, status: 'skipped', sequence, reason: 'Contact has no email.' }
  }

  const { data: generated } = await supabase
    .from('outbound_generated_content')
    .select('selected_subject_line, followups')
    .eq('contact_id', cc.contact_id)
    .maybeSingle()

  const followups = (generated?.followups ?? []) as Array<{ sequence: number; body: string }>
  const draft = followups.find(f => f.sequence === sequence)

  if (!generated?.selected_subject_line || !draft?.body) {
    return { campaignContactId, status: 'skipped', sequence, reason: `No generated follow-up ${sequence} content for this contact yet.` }
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
    return { campaignContactId, status: 'failed', sequence, reason: result.error }
  }
  if (result.status === 'suppressed') {
    return { campaignContactId, status: 'skipped', sequence, reason: result.error }
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
      manual: force,
    },
  })

  return { campaignContactId, status: 'sent', sequence }
}
