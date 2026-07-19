// ============================================================
// Admin: Send Campaign — POST /api/admin/outbound/campaigns/[id]/send
// ============================================================
// Sequential loop over this campaign's 'queued' contacts (not Promise.all
// — same discipline as useCompanyDiscoverySearch's researchSelected(),
// since a real sending provider rate-limits sends the same way search
// quota does). Each contact needs an already-generated email (subject +
// draft) — contacts missing one are skipped, left 'queued' for retry,
// not silently marked done. Mock provider only: no real email is sent.
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
  const supabase = createServerClient()

  const { data: queued, error: fetchError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id, contact_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')

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
    })

    if (result.status !== 'sent') {
      outcomes.push({ campaignContactId: item.id, status: 'failed', reason: result.error })
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
      detail: { providerMessageId: result.providerMessageId, providerUsed: result.providerUsed },
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
