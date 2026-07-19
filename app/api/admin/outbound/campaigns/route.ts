// ============================================================
// Admin: Outbound Campaigns — GET / POST /api/admin/outbound/campaigns
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  // Optional filter — used by Auto Flow's resumeFromRun() to find an
  // already-created campaign for this run after a mid-flow refresh, instead
  // of ensureCampaignId() unconditionally creating a new one (which would
  // re-send to contacts already marked 'sent' under the original campaign —
  // 2026-07-19 fix, see CLAUDE.md Track 5).
  const sourceRunId = req.nextUrl.searchParams.get('source_run_id')

  const supabase = createServerClient()
  let query = supabase.from('outbound_campaigns').select('*').order('created_at', { ascending: false })
  if (sourceRunId) query = query.eq('source_run_id', sourceRunId)
  const { data, error } = await query

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, campaigns: data ?? [] })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const { name, source_run_id } = body

  if (!name) {
    return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('outbound_campaigns')
    .insert({ name, source_run_id: source_run_id ?? null })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, campaign: data })
}
