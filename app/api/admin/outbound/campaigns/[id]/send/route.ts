// ============================================================
// Admin: Send Campaign — POST /api/admin/outbound/campaigns/[id]/send
// ============================================================
// Sequential loop over this campaign's 'queued' contacts (not Promise.all
// — same discipline as useCompanyDiscoverySearch's researchSelected(),
// since a real sending provider rate-limits sends the same way search
// quota does). Each contact needs an already-generated email (subject +
// draft) — contacts missing one are skipped, left 'queued' for retry,
// not silently marked done.
//
// Optional body: { contact_ids?: string[] } — scopes the send to exactly
// those contacts. Omitted (or Send All's own call) means every 'queued'
// contact in the campaign, which IS the intended "Send All" behavior.
// FIXED (2026-07-28): this used to have no such filter at all, so
// useAutoGtmFlow's sendOneContact() — which enqueues just one contact and
// calls this same endpoint — would actually send every OTHER already-queued
// contact in the campaign too, not just the one the user clicked "Send
// Email" on. Silent and harmless while sending was mock-only; a real
// correctness/consent bug the moment a real provider is connected, since
// "send to this one person" must not fan out to others.
//
// A provider result is only a failure when its status is literally
// 'failed' — SendEmailResult.status also has a 'queued' outcome, kept
// generic for any future async-scheduler-style provider (Gmail/mock both
// send synchronously and only ever return 'sent'). Both 'sent' and 'queued'
// mean "successfully handed off to the sending provider" from this app's
// perspective, so both advance the campaign contact to 'sent' here —
// outbound_campaign_contacts has no separate "handed off but not yet
// delivered" state, and the distinction is still preserved in the event's
// own detail.providerStatus for anyone inspecting the timeline.
//
// A 'suppressed' result (Session 3 — sendEmail() itself checked
// outbound_suppression_list before even attempting the send) is bucketed as
// 'skipped', not 'failed' — same as "no generated email yet": nothing went
// wrong, the send was correctly never attempted, and the contact stays
// 'queued' rather than being marked done.
//
// Daily send limit + send window (migration 020, lib/outbound/sending/
// campaign-limits.ts) are checked once up front (window) / once and then
// decremented locally per successful send (daily capacity) — not re-queried
// per contact, same "resolve shared context once" discipline as the Gmail
// credential resolution in process-followup.ts. A contact skipped for
// either reason is left 'queued' (retry-eligible later, once the window
// reopens or the next day starts), same as "no email yet"/"no draft yet".
//
// 'send_failed'/'suppressed' campaign_events (migration 020) are now
// inserted on those outcomes too — previously a failed or suppressed
// attempt updated status/left it queued but wrote NO event row at all, so
// the per-contact timeline had nothing to show for it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/outbound/sending/provider-factory'
import { isWithinSendWindow, remainingDailySendCapacity } from '@/lib/outbound/sending/campaign-limits'
import { claimCampaignContact } from '@/lib/outbound/sending/claim'
import { checkEmailFormat, checkCompanyIdentity } from '@/lib/outbound/sending/send-eligibility'
import { markOutreachedByIdentity } from '@/lib/companies/identity'
import { logger } from '@/lib/logger'

interface SendOutcome {
  campaignContactId: string
  // 'ambiguous' = a Gmail timeout/unknown error after the claim succeeded —
  // we can't tell if it actually sent, so this is deliberately left claimed
  // (not retry-eligible) instead of rolled back to 'queued'. See claim.ts.
  // 'blocked' = a non-overridable Phase B safety check refused this send
  // (invalid email format, company-identity conflict, or an unsupported
  // claim in the draft) — same checks campaign-review.ts uses to keep a
  // contact out of "ready", enforced again here as the real gate, since
  // this route can be called directly without going through Review & Send.
  status: 'sent' | 'skipped' | 'failed' | 'ambiguous' | 'blocked'
  reason?: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id: campaignId } = await params
  const body = await req.json().catch(() => ({}))
  const contactIdsFilter: string[] | undefined = Array.isArray(body?.contact_ids) ? body.contact_ids : undefined

  const supabase = createServerClient()

  const { data: campaign } = await supabase
    .from('outbound_campaigns')
    .select('status, daily_send_limit, send_window_start, send_window_end, timezone')
    .eq('id', campaignId)
    .maybeSingle()

  // Same entry-gate process-followups/route.ts already has — "Send All" had
  // no pause check at all before this fix (Production Hardening Master
  // Plan Phase A, Step A7), so pausing a campaign didn't actually stop a
  // fresh send request against it. A pause mid-batch (after this check
  // passes) still lets an already-fetched batch finish — same documented
  // behavior as process-followups and the follow-up engine tick, not
  // per-contact re-checked; the final status update below never re-activates
  // a campaign someone paused during the batch.
  if (campaign?.status === 'paused') {
    return NextResponse.json({ success: true, sent: 0, skipped: 0, failed: 0, total: 0, outcomes: [], message: 'Campaign is paused — no emails sent.' })
  }

  const withinWindow = campaign ? isWithinSendWindow(campaign) : true
  let remainingToday = campaign
    ? await remainingDailySendCapacity(supabase, campaignId, campaign.daily_send_limit, campaign.timezone)
    : Infinity

  let queuedQuery = supabase
    .from('outbound_campaign_contacts')
    .select('id, contact_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')

  if (contactIdsFilter && contactIdsFilter.length > 0) {
    queuedQuery = queuedQuery.in('contact_id', contactIdsFilter)
  }

  const { data: queued, error: fetchError } = await queuedQuery

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }

  const outcomes: SendOutcome[] = []

  for (const item of queued ?? []) {
    if (!withinWindow) {
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: 'Outside this campaign\'s configured sending window.' })
      continue
    }
    if (remainingToday <= 0) {
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: `Daily send limit reached (${campaign?.daily_send_limit}/day).` })
      continue
    }

    const { data: contact } = await supabase
      .from('outbound_contacts')
      .select('email, discovery_grounding_status, company_domain, company_name')
      .eq('id', item.contact_id)
      .maybeSingle()

    if (!contact?.email) {
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: 'Contact has no email yet.' })
      continue
    }

    // B6 / B4 (Phase B, safety policy — no override). Real enforcement, not
    // just a UI hint: this route can be called directly, bypassing Review &
    // Send's own classification in campaign-review.ts.
    const emailFormatCheck = checkEmailFormat(contact.email)
    if (emailFormatCheck.blocked) {
      outcomes.push({ campaignContactId: item.id, status: 'blocked', reason: emailFormatCheck.reason })
      continue
    }
    const identityCheck = checkCompanyIdentity(contact.discovery_grounding_status)
    if (identityCheck.blocked) {
      outcomes.push({ campaignContactId: item.id, status: 'blocked', reason: identityCheck.reason })
      continue
    }

    const { data: generated } = await supabase
      .from('outbound_generated_content')
      .select('id, selected_subject_line, email_draft')
      .eq('contact_id', item.contact_id)
      .maybeSingle()

    const emailDraft = generated?.email_draft as { fullText?: string; claimGroundingCheck?: { hasUnsupportedClaim?: boolean; reason?: string } } | null
    if (!generated || !generated.selected_subject_line || !emailDraft?.fullText) {
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: 'No generated email for this contact yet.' })
      continue
    }

    // B5 (Phase B, safety policy — no override).
    if (emailDraft.claimGroundingCheck?.hasUnsupportedClaim) {
      outcomes.push({
        campaignContactId: item.id, status: 'blocked',
        reason: emailDraft.claimGroundingCheck.reason ?? 'This draft contains an unsupported factual claim.',
      })
      continue
    }

    // Atomic claim (Production Hardening Master Plan, Step 8.6 — "a retry
    // must never send the same email twice"). This loop reads the whole
    // 'queued' set in one query above, then sends one at a time — two
    // overlapping calls to this route (a double-click, two open tabs) would
    // otherwise both read the same queued rows before either updates one,
    // and both would genuinely send a duplicate real email to the same
    // prospect. Flip to 'sent' NOW, conditioned on the row still being
    // 'queued' — Postgres's row-level update is atomic, so only one
    // concurrent request's WHERE clause can match. `claimed` empty means
    // another request already claimed (or otherwise moved) this row; skip
    // it here rather than sending again. Rolled back to 'queued' below if
    // the send itself then fails, preserving the existing "left queued for
    // retry" behavior.
    const claimed = await claimCampaignContact(supabase, item.id, 'queued', 'sent')

    if (!claimed) {
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: 'Already claimed by a concurrent send request.' })
      continue
    }

    const result = await sendEmail({
      campaignId,
      contactEmail: contact.email,
      subject: generated.selected_subject_line,
      body: emailDraft.fullText,
      campaignContactId: item.id,
    })

    if (result.status === 'failed') {
      if (result.ambiguous) {
        // Do NOT roll back to 'queued' — we can't tell whether Gmail
        // actually sent this (e.g. a timeout waiting for the response).
        // Leaving the row claimed 'sent' means no later retry can double-send
        // it; this needs a human to check the Gmail sent folder.
        remainingToday -= 1
        outcomes.push({ campaignContactId: item.id, status: 'ambiguous', reason: result.error })
        await supabase.from('outbound_campaign_events').insert({
          campaign_id: campaignId,
          campaign_contact_id: item.id,
          event_type: 'send_ambiguous',
          detail: { error: result.error, providerUsed: result.providerUsed },
        })
        continue
      }
      await supabase
        .from('outbound_campaign_contacts')
        .update({ status: 'queued', updated_at: new Date().toISOString() })
        .eq('id', item.id)
      outcomes.push({ campaignContactId: item.id, status: 'failed', reason: result.error })
      await supabase.from('outbound_campaign_events').insert({
        campaign_id: campaignId,
        campaign_contact_id: item.id,
        event_type: 'send_failed',
        detail: { error: result.error, providerUsed: result.providerUsed },
      })
      continue
    }
    if (result.status === 'suppressed') {
      await supabase
        .from('outbound_campaign_contacts')
        .update({ status: 'queued', updated_at: new Date().toISOString() })
        .eq('id', item.id)
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: result.error })
      await supabase.from('outbound_campaign_events').insert({
        campaign_id: campaignId,
        campaign_contact_id: item.id,
        event_type: 'suppressed',
        detail: { reason: result.error },
      })
      continue
    }

    remainingToday -= 1

    await supabase
      .from('outbound_campaign_contacts')
      .update({
        status: 'sent',
        generated_content_id: generated.id,
        provider_message_id: result.providerMessageId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    await supabase.from('outbound_campaign_events').insert({
      campaign_id: campaignId,
      campaign_contact_id: item.id,
      event_type: 'sent',
      detail: {
        providerMessageId: result.providerMessageId,
        providerUsed: result.providerUsed,
        providerStatus: result.status,
      },
    })

    // Outreach-lock (governing plan section D): a real send marks this
    // company 'outreached' in the persistent registry, so no future
    // discovery run or Excel/CSV upload can automatically resurface it —
    // only an explicit manual override in the UI can. Best-effort: a
    // failure here must never undo an already-successful send.
    if (contact.company_domain || contact.company_name) {
      try {
        await markOutreachedByIdentity(
          supabase,
          { domain: contact.company_domain, name: contact.company_name },
          campaignId,
        )
      } catch (e) {
        logger.warn('CampaignSend', 'outreach-lock write skipped', e instanceof Error ? e.message : String(e))
      }
    }

    outcomes.push({ campaignContactId: item.id, status: 'sent' })
  }

  // Never re-activates a campaign someone paused while this batch was
  // running (Phase A, Step A7) — the entry-gate above only catches a pause
  // that happened before this request started.
  await supabase
    .from('outbound_campaigns')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .neq('status', 'paused')

  return NextResponse.json({
    success: true,
    sent: outcomes.filter(o => o.status === 'sent').length,
    skipped: outcomes.filter(o => o.status === 'skipped').length,
    failed: outcomes.filter(o => o.status === 'failed').length,
    ambiguous: outcomes.filter(o => o.status === 'ambiguous').length,
    blocked: outcomes.filter(o => o.status === 'blocked').length,
    total: outcomes.length,
    outcomes,
  })
}
