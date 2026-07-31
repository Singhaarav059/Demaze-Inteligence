// ============================================================
// Admin: Remove Suppression Entry — DELETE /api/admin/outbound/suppression-list/[id]
// ============================================================
// Un-suppressing an address (e.g. a bounce that turns out to have been a
// transient mailbox-full error, not a permanent one) — no confirmation
// dialog on the frontend for this one deliberately; unlike Stop Remaining
// Follow-ups (a one-way door once acted on), removing a suppression entry
// is trivially reversible by re-adding it, so it doesn't carry the same
// "can't be undone" weight.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { removeFromSuppressionList } from '@/lib/outbound/sending/suppression'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const result = await removeFromSuppressionList(id)
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
