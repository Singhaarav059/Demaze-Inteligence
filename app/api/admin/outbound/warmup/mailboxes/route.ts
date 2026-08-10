// ============================================================
// Admin: Warm-Up Mailboxes — GET / POST /api/admin/outbound/warmup/mailboxes
// ============================================================
// GET attaches a `live_status` to each mailbox. For a manually-added
// mailbox (no credential_encrypted) this is unchanged from before: computed
// fresh from started_at via the mock provider on every read, no background
// job needed. For an OAuth-connected mailbox (2026-08-04, real warmup
// engine) it instead reads the latest REAL row lib/outbound/warmup/engine/
// run-tick.ts wrote into outbound_warmup_metrics — this route never
// computes or writes a fake snapshot for those, only reads what the engine
// already recorded.
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
      // credential_encrypted itself never leaves this route — only a
      // boolean derived from its presence, same discipline every other
      // vendor credential in this app follows (never expose the ciphertext
      // to the client).
      const oauthConnected = Boolean(mailbox.credential_encrypted)
      const { credential_encrypted: _credential, ...publicMailbox } = mailbox

      if (oauthConnected) {
        const { data: latestMetric } = await supabase
          .from('outbound_warmup_metrics')
          .select('emails_sent_total, inbox_rate, spam_rate, domain_health_score')
          .eq('mailbox_id', mailbox.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const liveStatus = latestMetric
          ? {
              status: mailbox.status === 'paused' ? ('paused' as const) : ('warming' as const),
              emailsSentTotal: latestMetric.emails_sent_total,
              inboxRate: latestMetric.inbox_rate,
              spamRate: latestMetric.spam_rate,
              domainHealthScore: latestMetric.domain_health_score,
            }
          : null // engine hasn't produced a real snapshot yet — honest "no data" rather than a fake one

        return { ...publicMailbox, oauth_connected: true, live_status: liveStatus }
      }

      if (!mailbox.started_at) return { ...publicMailbox, oauth_connected: false, live_status: null }
      const liveStatus = await getWarmupStatus({
        mailboxAddress: mailbox.mailbox_address,
        startedAt: mailbox.started_at,
        isPaused: mailbox.status === 'paused',
      })
      return { ...publicMailbox, oauth_connected: false, live_status: liveStatus }
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
