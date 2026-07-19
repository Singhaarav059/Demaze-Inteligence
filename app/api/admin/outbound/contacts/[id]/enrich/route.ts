// ============================================================
// Admin: Enrich Contact — POST /api/admin/outbound/contacts/[id]/enrich
// ============================================================
// Runs the active Contact Enrichment provider. When this contact has a
// source_run_id, pulls that run's already-researched company_size_estimate/
// industry from pipeline_test_runs.final_result and passes them in as
// known* hints — real research data beats an invented mock fixture.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { enrichContact } from '@/lib/outbound/enrichment/provider-factory'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { id } = await params
  const supabase = createServerClient()

  const { data: contact, error: fetchError } = await supabase
    .from('outbound_contacts')
    .select('id, person_name, company_name, linkedin_url, source_run_id')
    .eq('id', id)
    .single()

  if (fetchError || !contact) {
    return NextResponse.json({ success: false, error: fetchError?.message ?? 'Contact not found' }, { status: 404 })
  }

  let knownCompanySize: string | undefined
  let knownIndustry: string | undefined

  if (contact.source_run_id) {
    const { data: run } = await supabase
      .from('pipeline_test_runs')
      .select('final_result')
      .eq('id', contact.source_run_id)
      .maybeSingle()

    const finalResult = run?.final_result as Record<string, unknown> | undefined
    if (typeof finalResult?.company_size_estimate === 'string') knownCompanySize = finalResult.company_size_estimate
    if (typeof finalResult?.industry === 'string') knownIndustry = finalResult.industry
  }

  const result = await enrichContact({
    personName: contact.person_name,
    companyName: contact.company_name,
    linkedinUrl: contact.linkedin_url ?? undefined,
    knownCompanySize,
    knownIndustry,
  })

  const { data: updated, error: updateError } = await supabase
    .from('outbound_contacts')
    .update({
      enrichment: result,
      enrichment_status: result.status,
      enrichment_provider: result.providerUsed,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, contact: updated, result })
}
