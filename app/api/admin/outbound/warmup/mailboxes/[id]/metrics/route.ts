// ============================================================
// Admin: Warm-Up Metrics — GET /api/admin/outbound/warmup/mailboxes/[id]/metrics
// ============================================================
// For a manually-added mailbox (no credential_encrypted), unchanged from
// before: computes the current mock live status and appends it as a new
// snapshot on every view — no background job, the trend accumulates one
// point per page view instead.
//
// For an OAuth-connected mailbox (2026-08-04, real warmup engine), this
// route does NOT append anything — lib/outbound/warmup/engine/run-tick.ts
// is the only writer of real snapshots now, on its own schedule (a tick,
// not a page view). Appending a mock snapshot here for a real mailbox
// would corrupt its real time-series with fake data interleaved in it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getWarmupStatus } from '@/lib/outbound/warmup/provider-factory'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data: mailbox, error: fetchError } = await supabase
    .from('outbound_warmup_mailboxes')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !mailbox) {
    return NextResponse.json({ success: false, error: fetchError?.message ?? 'Mailbox not found' }, { status: 404 })
  }

  if (mailbox.started_at && !mailbox.credential_encrypted) {
    const live = await getWarmupStatus({
      mailboxAddress: mailbox.mailbox_address,
      startedAt: mailbox.started_at,
      isPaused: mailbox.status === 'paused',
    })

    await supabase.from('outbound_warmup_metrics').insert({
      mailbox_id: id,
      emails_sent_total: live.emailsSentTotal,
      inbox_rate: live.inboxRate,
      spam_rate: live.spamRate,
      domain_health_score: live.domainHealthScore,
    })
  }

  const { data: metrics, error: metricsError } = await supabase
    .from('outbound_warmup_metrics')
    .select('*')
    .eq('mailbox_id', id)
    .order('recorded_at', { ascending: true })

  if (metricsError) {
    return NextResponse.json({ success: false, error: metricsError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, metrics: metrics ?? [] })
}
