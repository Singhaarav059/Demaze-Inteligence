// ============================================================
// Admin: Outbound Contacts — GET / POST /api/admin/outbound/contacts
// ============================================================
// GET  — list contacts, optionally filtered by source_run_id
// POST — persists a contact. This route itself never discovers or ranks
//        who to contact — it only writes what the caller supplies. The
//        caller is either a human typing a name directly (discovery_source
//        defaults to 'manual'), or the Contacts page persisting a candidate
//        the user explicitly selected from Decision-Maker Discovery
//        (discovery_source='decision_maker_discovery') — discovery itself
//        happens in POST /api/admin/outbound/decision-makers/discover and
//        is never auto-persisted.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { searchParams } = new URL(req.url)
  const sourceRunId = searchParams.get('source_run_id')

  const supabase = createServerClient()

  let query = supabase
    .from('outbound_contacts')
    .select('*')
    .order('created_at', { ascending: false })

  if (sourceRunId) {
    query = query.eq('source_run_id', sourceRunId)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, contacts: data ?? [] })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const {
    source_run_id,
    company_domain,
    company_name,
    person_name,
    title_hint,
    linkedin_url,
    discovery_source,
    discovery_confidence,
    discovery_provider,
  } = body

  if (!company_domain || !company_name || !person_name) {
    return NextResponse.json(
      { success: false, error: 'company_domain, company_name, and person_name are required' },
      { status: 400 }
    )
  }

  const supabase = createServerClient()

  // discovery_source/confidence/provider are only sent to the DB when the
  // caller actually passed one — keeps plain manual adds working on a DB
  // that hasn't run migration 010 yet (those columns don't exist there).
  // A discovery-sourced add inherently requires migration 010 either way.
  const insertRow: Record<string, unknown> = {
    // '' (not just null/undefined) must also become null — source_run_id is
    // a UUID column, and an empty string sent by a caller with no real run
    // yet would otherwise fail the insert with a Postgres UUID-syntax error.
    source_run_id: source_run_id || null,
    company_domain,
    company_name,
    person_name,
    title_hint: title_hint ?? null,
    linkedin_url: linkedin_url ?? null,
  }
  if (discovery_source) {
    insertRow.discovery_source = discovery_source
    insertRow.discovery_confidence = discovery_confidence ?? null
    insertRow.discovery_provider = discovery_provider ?? null
  }

  const { data, error } = await supabase
    .from('outbound_contacts')
    .insert(insertRow)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, contact: data })
}
