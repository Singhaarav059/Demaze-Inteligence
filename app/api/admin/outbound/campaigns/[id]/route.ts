// ============================================================
// Admin: Single Outbound Campaign — GET / PATCH / DELETE
// /api/admin/outbound/campaigns/[id]
// ============================================================
// DELETE removes a campaign (e.g. a test/debug campaign, or one added by
// mistake). outbound_campaign_contacts.campaign_id and
// outbound_campaign_events.campaign_id are both ON DELETE CASCADE
// (migration 008), so this also destroys that campaign's enrollment rows
// and full send/reply event history — same cascade discipline already
// documented for deleting a contact (see contacts/[id]/route.ts's own
// header comment). Does NOT touch outbound_contacts or
// outbound_generated_content themselves — a contact enrolled in a deleted
// campaign still exists and can be re-enrolled elsewhere.
//
// GET/PATCH (migration 020, Campaign Settings) — the campaign's own name
// plus the new per-campaign sending-safety/cadence columns
// (daily_send_limit, send_window_start/end, timezone, interval_1/2/3_days).
// PATCH only ever touches fields present in the request body (partial
// update via a plain `.update(patch)`, not a full-row replace) so a caller
// can change just the name without needing to already know every other
// setting's current value.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

const PATCHABLE_FIELDS = [
  'name',
  'daily_send_limit',
  'send_window_start',
  'send_window_end',
  'timezone',
  'interval_1_days',
  'interval_2_days',
  'interval_3_days',
] as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase.from('outbound_campaigns').select('*').eq('id', id).maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, campaign: data })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const patch: Record<string, unknown> = {}
  for (const field of PATCHABLE_FIELDS) {
    if (field in body) patch[field] = body[field]
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ success: false, error: 'No recognized settings fields in request body' }, { status: 400 })
  }

  // Three-interval override is all-or-nothing (see followup-settings.ts's
  // getFollowupIntervals comment) — reject a partial set here rather than
  // silently storing an unusable combination that resolveIntervals would
  // then have to special-case.
  const intervalFields = ['interval_1_days', 'interval_2_days', 'interval_3_days'] as const
  const providedIntervals = intervalFields.filter(f => f in patch)
  if (providedIntervals.length > 0 && providedIntervals.length < 3) {
    return NextResponse.json(
      { success: false, error: 'Set all three follow-up interval days together, or none (to keep using the global default).' },
      { status: 400 }
    )
  }

  patch.updated_at = new Date().toISOString()

  const supabase = createServerClient()
  const { data, error } = await supabase.from('outbound_campaigns').update(patch).eq('id', id).select('*').single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, campaign: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { error } = await supabase.from('outbound_campaigns').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
