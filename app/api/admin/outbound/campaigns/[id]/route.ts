// ============================================================
// Admin: Single Outbound Campaign — DELETE /api/admin/outbound/campaigns/[id]
// ============================================================
// Removes a campaign (e.g. a test/debug campaign, or one added by mistake).
// outbound_campaign_contacts.campaign_id and outbound_campaign_events.
// campaign_id are both ON DELETE CASCADE (migration 008), so this also
// destroys that campaign's enrollment rows and full send/reply event
// history — same cascade discipline already documented for deleting a
// contact (see contacts/[id]/route.ts's own header comment). Does NOT
// touch outbound_contacts or outbound_generated_content themselves — a
// contact enrolled in a deleted campaign still exists and can be
// re-enrolled elsewhere.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

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
