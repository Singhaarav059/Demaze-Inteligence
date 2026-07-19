// ============================================================
// Admin: Warm-Up Mailboxes — GET / POST /api/admin/outbound/warmup/mailboxes
// ============================================================
// GET attaches a live-computed `live_status` to each mailbox (not stored —
// computed fresh from started_at on every read) so the dashboard always
// shows current numbers without needing a background job.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { startWarmup, getWarmupStatus } from '@/lib/outbound/warmup/provider-factory'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('outbound_warmup_mailboxes')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const mailboxes = await Promise.all(
    (data ?? []).map(async mailbox => {
      if (!mailbox.started_at) return { ...mailbox, live_status: null }
      const liveStatus = await getWarmupStatus({
        mailboxAddress: mailbox.mailbox_address,
        startedAt: mailbox.started_at,
        isPaused: mailbox.status === 'paused',
      })
      return { ...mailbox, live_status: liveStatus }
    })
  )

  return NextResponse.json({ success: true, mailboxes })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const mailboxAddress = typeof body.mailbox_address === 'string' ? body.mailbox_address.trim() : ''

  if (!mailboxAddress) {
    return NextResponse.json({ success: false, error: 'mailbox_address is required' }, { status: 400 })
  }

  const startResult = await startWarmup(mailboxAddress)

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('outbound_warmup_mailboxes')
    .insert({
      mailbox_address: mailboxAddress,
      provider_name: startResult.providerUsed,
      status: startResult.started ? 'warming' : 'not_started',
      started_at: startResult.started ? new Date().toISOString() : null,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, mailbox: data })
}
