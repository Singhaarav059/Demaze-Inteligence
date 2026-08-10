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
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/outbound/sending/provider-factory'

interface SendOutcome {
  campaignContactId: string
  status: 'sent' | 'skipped' | 'failed'
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
    const { data: contact } = await supabase
      .from('outbound_contacts')
      .select('email')
      .eq('id', item.contact_id)
      .maybeSingle()

    if (!contact?.email) {
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: 'Contact has no email yet.' })
      continue
    }

    const { data: generated } = await supabase
      .from('outbound_generated_content')
      .select('id, selected_subject_line, email_draft')
      .eq('contact_id', item.contact_id)
      .maybeSingle()

    const emailDraft = generated?.email_draft as { fullText?: string } | null
    if (!generated || !generated.selected_subject_line || !emailDraft?.fullText) {
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: 'No generated email for this contact yet.' })
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
      outcomes.push({ campaignContactId: item.id, status: 'failed', reason: result.error })
      continue
    }
    if (result.status === 'suppressed') {
      outcomes.push({ campaignContactId: item.id, status: 'skipped', reason: result.error })
      continue
    }

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

    outcomes.push({ campaignContactId: item.id, status: 'sent' })
  }

  await supabase
    .from('outbound_campaigns')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', campaignId)

  return NextResponse.json({
    success: true,
    sent: outcomes.filter(o => o.status === 'sent').length,
    skipped: outcomes.filter(o => o.status === 'skipped').length,
    failed: outcomes.filter(o => o.status === 'failed').length,
    total: outcomes.length,
    outcomes,
  })
}
