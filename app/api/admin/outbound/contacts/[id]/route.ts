// ============================================================
// Admin: Single Outbound Contact — DELETE /api/admin/outbound/contacts/[id]
// ============================================================
// Removes a contact (e.g. one added by mistake, or test data).
// NOT cascade-free: outbound_generated_content.contact_id and
// outbound_campaign_contacts.contact_id are both ON DELETE CASCADE
// (migrations 007/008), and outbound_campaign_events cascades again from
// outbound_campaign_contacts — so deleting a contact that's already
// enrolled in a campaign also silently destroys its generated outreach
// draft and its full send/reply event history for that campaign. The
// confirm dialog in ContactRow.tsx says so; this isn't guarded further
// (no "are you sure, this has campaign history" check) since this is an
// admin tool, not a production delete-safety-critical path.
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

  const { error } = await supabase.from('outbound_contacts').delete().eq('id', id)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
