// ============================================================
// Admin: Stop Remaining Follow-Ups — POST /api/admin/outbound/followups/[id]/stop
// ============================================================
// [id] is an outbound_campaign_contacts.id. Sets status='stopped' so this
// contact is excluded from both process-followups' ELIGIBLE_STATUSES query
// and the Follow-up Control Panel's own due-list — no further follow-up
// will ever be sent to them by this app. Reversible only by manually
// re-editing the row's status in Supabase directly; there's no "resume
// follow-ups" action, same one-way-door shape as marking a contact
// 'bounced'.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data: cc, error: fetchError } = await supabase
    .from('outbound_campaign_contacts')
    .select('campaign_id, status')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }
  if (!cc) {
    return NextResponse.json({ success: false, error: 'Campaign contact not found' }, { status: 404 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('outbound_campaign_contacts')
    .update({ status: 'stopped', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  const { error: eventError } = await supabase.from('outbound_campaign_events').insert({
    campaign_id: cc.campaign_id,
    campaign_contact_id: id,
    event_type: 'followup_stopped',
    detail: { previousStatus: cc.status, source: 'manual_admin_action' },
  })

  return NextResponse.json({
    success: true,
    campaignContact: updated,
    // followup_stopped requires migration 016 — surfaced here rather than
    // silently dropped, same "don't hide a write you can't verify"
    // discipline as check-replies/route.ts's 2026-07-29 fix.
    eventWarning: eventError ? `Status updated, but the event could not be recorded: ${eventError.message}` : undefined,
  })
}
