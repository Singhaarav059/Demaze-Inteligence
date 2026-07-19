// ============================================================
// Admin: Warm-Up Metrics — GET /api/admin/outbound/warmup/mailboxes/[id]/metrics
// ============================================================
// Computes the current live status and appends it as a new snapshot before
// returning the full time-series — this app has no background scheduler,
// so the trend accumulates one point per time this endpoint is viewed
// rather than on a fixed interval.
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

  if (mailbox.started_at) {
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
