// ============================================================
// Admin: Enrich Contact — POST /api/admin/outbound/contacts/[id]/enrich
// ============================================================
// Runs the active Contact Enrichment provider. When this contact has a
// source_run_id, pulls that run's already-researched company_size_estimate/
// industry from pipeline_test_runs.final_result and passes them in as
// known* hints — real research data beats an invented mock fixture.
//
// When the active provider (for both enrichment AND email_finder) is
// Prospeo, this shares ONE Prospeo call with the /find-email route instead
// of each route paying for its own — see lib/outbound/shared/
// prospeo-contact-cache.ts. Any other provider (mock, or a future non-
// Prospeo vendor) is unaffected and goes through the original
// enrichContact() factory path unchanged.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { enrichContact } from '@/lib/outbound/enrichment/provider-factory'
import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import { resolveProspeoPerson } from '@/lib/outbound/shared/prospeo-contact-cache'
import { interpretProspeoEnrichmentResult } from '@/lib/outbound/enrichment/providers/prospeo'
import { interpretProspeoEmailResult } from '@/lib/outbound/email-finder/providers/prospeo'
import type { ProspeoEnrichPersonResponse } from '@/lib/outbound/shared/prospeo-client'
import type { EnrichmentResult } from '@/lib/outbound/enrichment/types'

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
    .select('id, person_name, company_name, company_domain, linkedin_url, source_run_id, email_finder_status, prospeo_raw')
    .eq('id', id)
    .single()

  if (fetchError) {
    // PGRST116 = PostgREST's real "no rows for .single()" code — an actual
    // missing contact. Any other code (e.g. a missing column after a
    // migration hasn't been applied yet) is a schema/query error, not a
    // 404, and was previously misreported as one.
    const status = fetchError.code === 'PGRST116' ? 404 : 500
    return NextResponse.json({ success: false, error: fetchError.message }, { status })
  }
  if (!contact) {
    return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 })
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

  const [enrichmentProvider, emailFinderProvider] = await Promise.all([
    getActiveProviderName('enrichment'),
    getActiveProviderName('email_finder'),
  ])

  let result: EnrichmentResult
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (enrichmentProvider === 'prospeo') {
    const resolved = await resolveProspeoPerson(
      {
        personName: contact.person_name,
        companyName: contact.company_name,
        domain: contact.company_domain,
        linkedinUrl: contact.linkedin_url ?? undefined,
      },
      (contact.prospeo_raw as ProspeoEnrichPersonResponse | null) ?? null,
      'enrichment',
    )

    if (!resolved) {
      result = await enrichContact({
        personName: contact.person_name,
        companyName: contact.company_name,
        linkedinUrl: contact.linkedin_url ?? undefined,
        knownCompanySize,
        knownIndustry,
      })
    } else {
      result = interpretProspeoEnrichmentResult(resolved.result, { knownCompanySize, knownIndustry })

      if (!resolved.fromCache && resolved.result.ok) {
        update.prospeo_raw = resolved.result.data
        update.prospeo_fetched_at = new Date().toISOString()
      }

      // Opportunistically backfill email too — same single-response reuse
      // as the /find-email route does in the other direction.
      if (contact.email_finder_status === 'pending' && emailFinderProvider === 'prospeo' && resolved.result.ok) {
        const emailResult = interpretProspeoEmailResult(resolved.result)
        update.email = emailResult.email
        update.email_confidence = emailResult.confidence
        update.email_finder_provider = emailResult.providerUsed
        update.email_finder_status = emailResult.status
      }
    }
  } else {
    result = await enrichContact({
      personName: contact.person_name,
      companyName: contact.company_name,
      linkedinUrl: contact.linkedin_url ?? undefined,
      knownCompanySize,
      knownIndustry,
    })
  }

  update.enrichment = result
  update.enrichment_status = result.status
  update.enrichment_provider = result.providerUsed

  const { data: updated, error: updateError } = await supabase
    .from('outbound_contacts')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, contact: updated, result })
}
