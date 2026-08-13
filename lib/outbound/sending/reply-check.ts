// ============================================================
// Reply/Bounce Check — shared by the manual button and the automatic
// follow-up engine
// ============================================================
// Extracted verbatim (2026-08-05) from
// app/api/admin/outbound/campaigns/[id]/check-replies/route.ts's loop body,
// so the automatic follow-up engine (lib/outbound/sending/followup-engine/)
// can run the exact same reply/bounce detection before deciding what's due,
// without duplicating it. The route itself becomes a thin wrapper around
// this function — same credential/token resolution, same response shape,
// zero behavior change for the existing manual "Check for Replies" button.
//
// Preserves the original route's fallback branch for when cred.email is
// unset — this deliberately differs from process-followup.ts's own inline
// reply check, which has no such fallback (it just reports no reply at all
// in that case). Do not simplify/unify the two; they were written for
// slightly different situations and this extraction is not the place to
// reconcile that.
//
// FIXED (audit follow-up): the fallback itself used to be
// `thread.messages.length > 1 => treat the LAST message as a reply` — a
// pure position-based guess, with no check of who actually sent it. A
// manual reply/forward sent from the connected account's own Gmail UI into
// the same thread (a real, reachable scenario — cred.email comes from a
// userinfo API call at OAuth-connect time that can itself fail/be denied,
// see gmail-client.ts's GmailCredential.email being optional) would have
// been misfiled as a prospect reply, incorrectly stopping that contact's
// follow-ups. Now uses Gmail's own authoritative 'SENT' label
// (getGmailThread always populates labelIds — see that function's own
// comment) to find genuinely non-sent messages even without a known
// connectedEmail to string-match against — strictly more accurate than the
// old position-based guess, not a redesign of the fallback's existence.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import {
  getGmailThread,
  findReplyInThread,
  findReplyInThreadByLabel,
  looksLikeBounce,
} from '@/lib/outbound/shared/gmail-client'
import { addToSuppressionList } from '@/lib/outbound/sending/suppression'

const SENT_STATUSES = ['sent', 'followup_1', 'followup_2', 'followup_3']

export interface ReplyCheckSummary {
  checked: number
  newReplies: number
  newBounces: number
  errors: string[]
}

export async function checkRepliesForCampaign(
  supabase: ReturnType<typeof createServerClient>,
  campaignId: string,
  accessToken: string,
  connectedEmail?: string
): Promise<ReplyCheckSummary> {
  const { data: contacts, error: fetchError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id, contact_id, provider_message_id')
    .eq('campaign_id', campaignId)
    .in('status', SENT_STATUSES)
    .not('provider_message_id', 'is', null)

  if (fetchError) {
    return { checked: 0, newReplies: 0, newBounces: 0, errors: [fetchError.message] }
  }

  let newReplies = 0
  let newBounces = 0
  const errors: string[] = []

  for (const contact of contacts ?? []) {
    const threadId = contact.provider_message_id as string
    const thread = await getGmailThread(threadId, accessToken)
    if (!thread.ok) continue // one bad thread lookup shouldn't abort the whole batch

    const reply = connectedEmail
      ? findReplyInThread(thread.messages, connectedEmail)
      : findReplyInThreadByLabel(thread.messages)

    if (!reply.hasReply) continue

    if (reply.replyMessageId) {
      const { data: existing } = await supabase
        .from('outbound_campaign_events')
        .select('id')
        .eq('provider_event_id', reply.replyMessageId)
        .maybeSingle()
      if (existing) continue // already recorded on a previous check
    }

    const replyMessage = thread.messages.find(m => m.id === reply.replyMessageId)
    const isBounce = replyMessage ? looksLikeBounce(replyMessage) : false
    const fromHeader = 'fromHeader' in reply ? reply.fromHeader : undefined

    const { error: insertError } = await supabase.from('outbound_campaign_events').insert({
      campaign_id: campaignId,
      campaign_contact_id: contact.id,
      event_type: isBounce ? 'bounced' : 'replied',
      provider_event_id: reply.replyMessageId ?? null,
      detail: { source: 'gmail_poll', threadId, fromHeader },
    })

    if (insertError) {
      errors.push(`contact ${contact.id}: failed to record ${isBounce ? 'bounce' : 'reply'} event — ${insertError.message}`)
      continue
    }

    const { error: updateError } = await supabase
      .from('outbound_campaign_contacts')
      .update({ status: isBounce ? 'bounced' : 'replied', updated_at: new Date().toISOString() })
      .eq('id', contact.id)

    if (updateError) {
      errors.push(`contact ${contact.id}: event recorded but status update failed — ${updateError.message}`)
      continue
    }

    if (isBounce) {
      newBounces += 1
      const { data: outboundContact } = await supabase
        .from('outbound_contacts')
        .select('email')
        .eq('id', contact.contact_id)
        .maybeSingle()
      if (outboundContact?.email) {
        const suppressed = await addToSuppressionList({
          email: outboundContact.email,
          reason: 'bounced',
          detail: fromHeader ? `Gmail bounce notice from: ${fromHeader}` : 'Gmail bounce detected during reply check.',
          contactId: contact.contact_id,
          campaignId,
        })
        if (!suppressed.ok) errors.push(`contact ${contact.id}: bounce detected but could not add to suppression list — ${suppressed.error}`)
      }
    } else {
      newReplies += 1
    }
  }

  return { checked: contacts?.length ?? 0, newReplies, newBounces, errors }
}
