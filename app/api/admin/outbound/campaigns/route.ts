// ============================================================
// Admin: Outbound Campaigns — GET / POST /api/admin/outbound/campaigns
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  // Optional filter — historically used by Auto Flow's resumeFromRun() to
  // find an already-created campaign for this run. Kept for any other
  // caller, but resumeFromRun itself no longer uses this (2026-08-05 fix,
  // see contact_ids below): source_run_id only exists on a SINGLE-company
  // campaign, so this filter silently misses batch campaigns entirely
  // (batch campaigns are one shared row created with source_run_id: null).
  const sourceRunId = req.nextUrl.searchParams.get('source_run_id')

  // contact_ids (comma-separated outbound_contacts.id list) — finds
  // whichever campaign(s) already have ANY of these contacts enqueued, via
  // outbound_campaign_contacts. Works for both single-company AND
  // batch-originated companies (outbound_contacts.source_run_id is reliably
  // set per-company either way, so the caller already knows which contacts
  // belong to "this company" before calling this). This is what
  // resumeFromRun() now uses instead of source_run_id — see that function's
  // own comment for the duplicate-campaign bug this fixes.
  const contactIdsParam = req.nextUrl.searchParams.get('contact_ids')

  const supabase = createServerClient()

  if (contactIdsParam) {
    const contactIds = contactIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (contactIds.length === 0) {
      return NextResponse.json({ success: true, campaigns: [] })
    }
    const { data: ccRows, error: ccError } = await supabase
      .from('outbound_campaign_contacts')
      .select('campaign_id')
      .in('contact_id', contactIds)
    if (ccError) {
      return NextResponse.json({ success: false, error: ccError.message }, { status: 500 })
    }
    const campaignIds = Array.from(new Set((ccRows ?? []).map(r => r.campaign_id)))
    if (campaignIds.length === 0) {
      return NextResponse.json({ success: true, campaigns: [] })
    }
    const { data, error } = await supabase
      .from('outbound_campaigns')
      .select('*')
      .in('id', campaignIds)
      .order('created_at', { ascending: false })
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, campaigns: data ?? [] })
  }

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
