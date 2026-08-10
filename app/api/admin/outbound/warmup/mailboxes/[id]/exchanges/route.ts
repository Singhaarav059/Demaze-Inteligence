// ============================================================
// Admin: Warm-Up Recent Activity — GET /api/admin/outbound/warmup/mailboxes/[id]/exchanges
// ============================================================
// Last ~20 outbound_warmup_exchanges rows where this mailbox is either
// side (sender or recipient), each annotated with the OTHER mailbox's
// address and a `direction` — so the warmup engine isn't a total black box
// once it's running (see app/admin/outbound/warmup/page.tsx's "Recent
// Activity" section).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

const RECENT_LIMIT = 20

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data: sent, error: sentError } = await supabase
    .from('outbound_warmup_exchanges')
    .select('id, to_mailbox_id, subject, sent_at, status, landed_in_spam, rescued_from_spam, replied')
    .eq('from_mailbox_id', id)
    .order('sent_at', { ascending: false })
    .limit(RECENT_LIMIT)

  const { data: received, error: receivedError } = await supabase
    .from('outbound_warmup_exchanges')
    .select('id, from_mailbox_id, subject, sent_at, status, landed_in_spam, rescued_from_spam, replied')
    .eq('to_mailbox_id', id)
    .order('sent_at', { ascending: false })
    .limit(RECENT_LIMIT)

  if (sentError || receivedError) {
    return NextResponse.json(
      { success: false, error: (sentError ?? receivedError)?.message },
      { status: 500 }
    )
  }

  const otherIds = new Set<string>()
  for (const row of sent ?? []) otherIds.add(row.to_mailbox_id)
  for (const row of received ?? []) otherIds.add(row.from_mailbox_id)

  const { data: otherMailboxes } = otherIds.size > 0
    ? await supabase.from('outbound_warmup_mailboxes').select('id, mailbox_address').in('id', Array.from(otherIds))
    : { data: [] as Array<{ id: string; mailbox_address: string }> }

  const addressById = new Map((otherMailboxes ?? []).map(m => [m.id, m.mailbox_address]))

  const outgoing = (sent ?? []).map(row => ({
    id: row.id,
    direction: 'sent' as const,
    otherAddress: addressById.get(row.to_mailbox_id) ?? 'unknown',
    subject: row.subject,
    sentAt: row.sent_at,
    status: row.status,
    landedInSpam: row.landed_in_spam,
    rescuedFromSpam: row.rescued_from_spam,
    replied: row.replied,
  }))

  const incoming = (received ?? []).map(row => ({
    id: row.id,
    direction: 'received' as const,
    otherAddress: addressById.get(row.from_mailbox_id) ?? 'unknown',
    subject: row.subject,
    sentAt: row.sent_at,
    status: row.status,
    landedInSpam: row.landed_in_spam,
    rescuedFromSpam: row.rescued_from_spam,
    replied: row.replied,
  }))

  const exchanges = [...outgoing, ...incoming]
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
    .slice(0, RECENT_LIMIT)

  return NextResponse.json({ success: true, exchanges })
}
