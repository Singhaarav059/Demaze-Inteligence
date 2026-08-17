// ============================================================
// Admin: Pilot Review — one company — PATCH /api/admin/outbound/pilot-review/[runId]
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase F2. Records a human's
// approve/reject/needs-work decision for one pilot company's researched
// run. This is the only write this route performs — it never touches
// outreach generation or sending; those stay gated behind their own
// existing checks (campaign-review.ts, send-eligibility.ts) regardless of
// what's recorded here.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'needs_work']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { runId } = await params
  const body = await req.json().catch(() => ({}))
  const { status, note } = body as { status?: string; note?: string }

  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ success: false, error: `status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('pipeline_test_runs')
    .update({
      pilot_review_status: status,
      pilot_review_note: note ?? null,
      pilot_reviewed_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .not('pilot_review_status', 'is', null) // only ever updates rows already tagged as pilot-reviewable
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'Run not found or not part of a pilot batch.' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
