// ============================================================
// Admin: Follow-Up Control Panel list — GET /api/admin/outbound/followups
// ============================================================
// Every campaign_contact still owed a follow-up (status sent/followup_1/
// followup_2/followup_3 — the same ELIGIBLE_STATUSES shape as
// process-followups/route.ts, minus followup_3 there since that route only
// needs contacts with a NEXT sequence, whereas this list also shows a
// followup_3 contact so the admin can see "nothing left, fully sequenced"
// rather than it just vanishing), annotated with the computed next-due
// date/sequence and the generated draft for that step — this is a
// read-only status view; sending/stopping/editing happen via the sibling
// action routes under /followups/[id]/.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getFollowupIntervals } from '@/lib/outbound/sending/followup-settings'
import { nextFollowupSequence, nextFollowupDueAt, buildFollowupSubject } from '@/lib/outbound/sending/followup-schedule'

const ACTIVE_SEQUENCE_STATUSES = ['sent', 'followup_1', 'followup_2', 'followup_3']

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const supabase = createServerClient()
  const intervals = await getFollowupIntervals()

  const { data, error } = await supabase
    .from('outbound_campaign_contacts')
    .select(
      `id, campaign_id, contact_id, status, updated_at,
       outbound_contacts(person_name, email, company_name),
       outbound_campaigns(name, status),
       outbound_generated_content(selected_subject_line, followups)`
    )
    .in('status', ACTIVE_SEQUENCE_STATUSES)
    .order('updated_at', { ascending: true })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const now = new Date()
  const rows = (data ?? []).map(cc => {
    const sequence = nextFollowupSequence(cc.status)
    const dueAt = sequence !== null ? nextFollowupDueAt(cc.status, cc.updated_at, intervals) : null
    const contact = cc.outbound_contacts as unknown as { person_name: string; email: string | null; company_name: string } | null
    const campaign = cc.outbound_campaigns as unknown as { name: string; status: string } | null
    const generated = cc.outbound_generated_content as unknown as {
      selected_subject_line: string | null
      followups: Array<{ sequence: number; body: string }> | null
    } | null
    const draft = sequence !== null ? generated?.followups?.find(f => f.sequence === sequence) ?? null : null

    return {
      id: cc.id,
      campaignId: cc.campaign_id,
      campaignName: campaign?.name ?? '—',
      campaignPaused: campaign?.status === 'paused',
      contactId: cc.contact_id,
      personName: contact?.person_name ?? '—',
      companyName: contact?.company_name ?? '—',
      email: contact?.email ?? null,
      status: cc.status,
      updatedAt: cc.updated_at,
      sequence,
      dueAt: dueAt?.toISOString() ?? null,
      overdue: dueAt !== null && now.getTime() >= dueAt.getTime(),
      draftSubject: generated?.selected_subject_line ? buildFollowupSubject(generated.selected_subject_line) : null,
      draftBody: draft?.body ?? null,
    }
  })

  rows.sort((a, b) => {
    if (a.dueAt === null) return 1
    if (b.dueAt === null) return -1
    return a.dueAt.localeCompare(b.dueAt)
  })

  return NextResponse.json({ success: true, intervals, rows })
}
