// ============================================================
// Admin: Warm-Up Mailbox Disconnect — POST /api/admin/outbound/warmup/mailboxes/[id]/disconnect
// ============================================================
// Revokes this app's stored OAuth access without deleting the mailbox row
// or its warm-up history — clears credential_encrypted/oauth_connected_at
// only, leaving mailbox_address/started_at/status untouched. This is
// deliberate: the engine's own mailbox-selection query
// (run-tick.ts, `.not('credential_encrypted', 'is', null)`) already
// excludes any mailbox with a null credential, so clearing it alone is
// sufficient to fully stop this mailbox from sending/receiving/being
// selected as a recipient — no other engine change needed. Reconnecting
// the same address later (POST .../oauth/callback) preserves the existing
// started_at/status, same "never reset someone's warm-up ramp" behavior
// already documented on that route.
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

  const { data: mailbox, error: fetchError } = await supabase
    .from('outbound_warmup_mailboxes')
    .select('id, mailbox_address, credential_encrypted')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }
  if (!mailbox) {
    return NextResponse.json({ success: false, error: 'Mailbox not found' }, { status: 404 })
  }
  if (!mailbox.credential_encrypted) {
    return NextResponse.json(
      { success: false, error: 'This mailbox has no OAuth connection to disconnect.' },
      { status: 400 }
    )
  }

  const { error: updateError } = await supabase
    .from('outbound_warmup_mailboxes')
    .update({
      credential_encrypted: null,
      oauth_connected_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, mailboxAddress: mailbox.mailbox_address })
}
