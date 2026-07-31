// ============================================================
// Admin: Send One Follow-Up Now — POST /api/admin/outbound/followups/[id]/send-now
// ============================================================
// [id] is an outbound_campaign_contacts.id. Forces the next follow-up in
// this contact's sequence to send immediately, regardless of whether the
// configured cadence says it's due yet (force=true — see
// lib/outbound/sending/process-followup.ts). Still checks for a reply
// first when Gmail is active, same as the scheduled path — a reply means
// this send is correctly skipped ('cancelled_reply'), not overridden.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getFollowupIntervals } from '@/lib/outbound/sending/followup-settings'
import { processFollowupForContact, resolveGmailContext } from '@/lib/outbound/sending/process-followup'

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
    .select('campaign_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }
  if (!cc) {
    return NextResponse.json({ success: false, error: 'Campaign contact not found' }, { status: 404 })
  }

  const [gmail, intervalsDays] = await Promise.all([resolveGmailContext(), getFollowupIntervals()])

  const outcome = await processFollowupForContact(supabase, cc.campaign_id, id, gmail, intervalsDays, true)

  return NextResponse.json({ success: true, outcome })
}
