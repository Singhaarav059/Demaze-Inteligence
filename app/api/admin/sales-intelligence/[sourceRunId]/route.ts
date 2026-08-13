// ============================================================
// Admin: Sales Intelligence — GET / PATCH /api/admin/sales-intelligence/[sourceRunId]
// ============================================================
// GET — returns the row, or { salesIntelligence: null } if never generated
// (degrade-gracefully contract — this is a normal, expected state, not an
// error, for any run predating this feature or never taken past Research).
//
// PATCH — whitelists only the active_* override fields + status, same
// whitelist-only-mutate convention as .../generated-content/route.ts.
// Setting any active_* field server-side-forces is_overridden = true —
// never trusted from the client, so a stray/incomplete PATCH body can't
// silently misreport whether a human actually changed anything.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

const ACTIVE_ARRAY_FIELDS = ['active_case_study_ids', 'active_roles'] as const

export async function GET(req: NextRequest, { params }: { params: Promise<{ sourceRunId: string }> }) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { sourceRunId } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('outbound_sales_intelligence')
    .select('*')
    .eq('source_run_id', sourceRunId)
    .maybeSingle()

  if (error) {
    // Table not existing yet (migration 022 not applied) degrades the same
    // as "never generated" — Auto Flow must keep working either way.
    return NextResponse.json({ success: true, salesIntelligence: null })
  }

  return NextResponse.json({ success: true, salesIntelligence: data ?? null })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sourceRunId: string }> }) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { sourceRunId } = await params
  const body = await req.json()

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let touchedAnyActiveField = false

  for (const key of [
    'active_industry_slug',
    'active_problem_slug',
    'active_capability_slug',
    'active_cta',
    'active_positioning_text',
  ]) {
    if (key in body) {
      update[key] = typeof body[key] === 'string' && body[key].trim() ? body[key].trim() : null
      touchedAnyActiveField = true
    }
  }
  for (const key of ACTIVE_ARRAY_FIELDS) {
    if (key in body) {
      update[key] = Array.isArray(body[key]) ? body[key].filter((v: unknown) => typeof v === 'string') : null
      touchedAnyActiveField = true
    }
  }
  if ('status' in body && (body.status === 'generated' || body.status === 'reviewed' || body.status === 'stale')) {
    update.status = body.status
  }

  if (touchedAnyActiveField) update.is_overridden = true

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('outbound_sales_intelligence')
    .update(update)
    .eq('source_run_id', sourceRunId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, salesIntelligence: data })
}
