// ============================================================
// Admin: Enqueue Campaign Contacts — POST /api/admin/outbound/campaigns/[id]/contacts
// ============================================================
// Body: { contact_ids: string[] }. Duplicate (campaign_id, contact_id)
// pairs are ignored (unique index) rather than erroring.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getFollowupIntervals } from '@/lib/outbound/sending/followup-settings'
import { nextFollowupDueAt } from '@/lib/outbound/sending/followup-schedule'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('outbound_campaign_contacts')
    .select('*, outbound_contacts(person_name, email, company_name)')
    .eq('campaign_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  // Additive field (2026-08-05, Auto Flow's Track & Follow Up step) — every
  // existing caller of this route (Campaigns page's Queue list,
  // useAutoGtmFlow's resumeFromRun/enqueueAndSend) already ignores unknown
  // response fields, so this doesn't change behavior for them.
  const intervalsDays = await getFollowupIntervals(id)

  // Second additive field (2026-08-12, step-6 Campaign Dashboard's
  // "Suppressed" segment) — is this contact's email CURRENTLY on the
  // suppression list, regardless of its own campaign_contacts.status.
  // Deliberately a direct bulk lookup here, not
  // lib/outbound/sending/campaign-review.ts's classifier: that classifier
  // answers "is this NOT-yet-sent contact blocked from sending" (an
  // already-sent/bounced contact never reaches its suppression check at
  // all) — this route needs the plain, current fact for every row
  // regardless of status, which is a different question.
  const emails = Array.from(
    new Set(
      ((data ?? []) as Array<{ outbound_contacts: { email: string | null } | null }>)
        .map(cc => cc.outbound_contacts?.email)
        .filter((e): e is string => Boolean(e))
        .map(e => e.trim().toLowerCase())
    )
  )
  const suppressionByEmail = new Map<string, { reason: string; detail: string | null }>()
  if (emails.length > 0) {
    const { data: suppressionRows } = await supabase
      .from('outbound_suppression_list')
      .select('email, reason, detail')
      .in('email', emails)
    for (const row of suppressionRows ?? []) suppressionByEmail.set(row.email, { reason: row.reason, detail: row.detail })
  }

  const contacts = (data ?? []).map(cc => {
    const email = (cc as unknown as { outbound_contacts: { email: string | null } | null }).outbound_contacts?.email
    const normalizedEmail = email ? email.trim().toLowerCase() : null
    return {
      ...cc,
      nextFollowupDueAt: nextFollowupDueAt(cc.status, cc.updated_at, intervalsDays)?.toISOString() ?? null,
      suppression: normalizedEmail ? (suppressionByEmail.get(normalizedEmail) ?? null) : null,
    }
  })

  return NextResponse.json({ success: true, contacts })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const body = await req.json()
  const contactIds: string[] = Array.isArray(body.contact_ids) ? body.contact_ids : []

  if (contactIds.length === 0) {
    return NextResponse.json({ success: false, error: 'contact_ids must be a non-empty array' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('outbound_campaign_contacts')
    .upsert(
      contactIds.map(contactId => ({ campaign_id: id, contact_id: contactId })),
      { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true }
    )
    .select('*')

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, enqueued: data ?? [] })
}
