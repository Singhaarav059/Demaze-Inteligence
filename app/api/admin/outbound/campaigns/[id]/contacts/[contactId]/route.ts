// ============================================================
// Admin: Remove a Contact from a Campaign — DELETE
// /api/admin/outbound/campaigns/[id]/contacts/[contactId]
// ============================================================
// [contactId] is an outbound_contacts.id (matches every other
// contact-scoped param in this app, e.g. campaigns/[id]/route.ts's
// contact_ids query params) — this route looks up the corresponding
// outbound_campaign_contacts row itself rather than requiring the caller to
// already know its id.
//
// Only allowed while the row is still 'queued' — a contact that's already
// sent/replied/bounced/etc. has real send history; removing that row would
// silently erase it (and cascade-delete its campaign_events, migration
// 008), which is a materially different, more destructive action than
// "take this contact out of the batch before it's sent." Review & Send's UI
// only ever offers Remove for not-yet-sent contacts anyway, but the route
// itself enforces this rather than trusting the caller.
//
// A 'removed' campaign_event (migration 020) is recorded against the
// CAMPAIGN (campaign_contact_id: null) before the row is deleted — the
// per-contact row and its own event history are about to cascade-delete
// (ON DELETE CASCADE, migration 008), so this is the only place left to
// keep any trace that a removal happened.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id: campaignId, contactId } = await params
  const supabase = createServerClient()

  const { data: cc, error: fetchError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id, status')
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }
  if (!cc) {
    // Not enqueued at all yet — nothing to remove server-side; the caller
    // (Review & Send) should just drop it from its own local send batch.
    return NextResponse.json({ success: true, removed: false, reason: 'not_enqueued' })
  }
  if (cc.status !== 'queued') {
    return NextResponse.json(
      { success: false, error: `Can't remove — this contact's status is "${cc.status}", not "queued".` },
      { status: 400 }
    )
  }

  await supabase.from('outbound_campaign_events').insert({
    campaign_id: campaignId,
    campaign_contact_id: null,
    event_type: 'removed',
    detail: { contactId, source: 'review_and_send' },
  })

  const { error: deleteError } = await supabase.from('outbound_campaign_contacts').delete().eq('id', cc.id)
  if (deleteError) {
    return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, removed: true })
}
