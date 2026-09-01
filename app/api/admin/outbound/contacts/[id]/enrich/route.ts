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
import { shouldOverwriteEnrichment } from '@/lib/outbound/shared/contact-update-guard'
import { ExaEnrichmentProvider } from '@/lib/outbound/enrichment/providers/exa'
import type { ProspeoEnrichPersonResponse } from '@/lib/outbound/shared/prospeo-client'
import type { EnrichmentResult } from '@/lib/outbound/enrichment/types'

// Orchestration scoped to this one route only (per instruction — not a new
// provider-factory capability, not a config toggle). "Thin" is deliberately
// conservative: only the 3 core fields count — roleCategory/linkedinSummary/
// companySize/industry are secondary and don't trigger a second, paid call.
// See benchmarks/exa/REPORT.md section 6: Prospeo and Exa are roughly
// comparable on accuracy but Prospeo is 5-8x faster, so Exa is only worth
// its cost when Prospeo's result is genuinely thin.
const CORE_FIELDS = ['department', 'seniority', 'location'] as const
const MERGE_FIELDS = [...CORE_FIELDS, 'roleCategory', 'linkedinSummary', 'companySize', 'industry'] as const
const CONFIDENCE_RANK: Record<EnrichmentResult['confidence'], number> = { low: 0, medium: 1, high: 2 }

function isThinEnrichment(result: EnrichmentResult): boolean {
  return CORE_FIELDS.every(f => !result[f])
}

// Primary's non-empty fields always win; the supplement only fills a field
// the primary left genuinely empty — never a silent combine. Returns which
// provider(s) actually contributed a field, for the caller to surface.
function mergeEnrichment(primary: EnrichmentResult, supplement: EnrichmentResult): { result: EnrichmentResult; sources: string[] } {
  const merged: EnrichmentResult = { ...primary }
  const sources = new Set<string>()

  for (const field of MERGE_FIELDS) {
    if (primary[field]) {
      sources.add(primary.providerUsed)
    } else if (supplement[field]) {
      merged[field] = supplement[field]
      sources.add(supplement.providerUsed)
    }
  }

  const hasCore = CORE_FIELDS.some(f => merged[f])
  const hasAny = hasCore || MERGE_FIELDS.some(f => merged[f])
  merged.status = hasCore ? 'enriched' : hasAny ? 'partial' : 'not_found'
  // Take the stronger of the two confidences, but only from a provider that
  // actually contributed a field — a provider's confidence about data it
  // didn't end up supplying isn't relevant to the merged result.
  merged.confidence =
    sources.has(supplement.providerUsed) && CONFIDENCE_RANK[supplement.confidence] > CONFIDENCE_RANK[primary.confidence]
      ? supplement.confidence
      : primary.confidence

  return { result: merged, sources: [...sources] }
}

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
    .select('id, person_name, company_name, company_domain, linkedin_url, source_run_id, email_finder_status, enrichment_status, enrichment, prospeo_raw')
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

  // Selective supplement, not a double-call-every-time model: only reach
  // for Exa when the primary result is genuinely thin, and never when Exa
  // IS the primary (that would just be the same provider called twice).
  // See benchmarks/exa/REPORT.md section 6 — the evidence this is scoped on.
  // Best-effort, like the cache writes elsewhere in this route family — a
  // failed/unavailable supplement must never break the primary provider's
  // already-good result.
  let enrichmentSources: string[] = result.status === 'not_found' ? [] : [result.providerUsed]
  if (enrichmentProvider !== 'exa' && isThinEnrichment(result)) {
    try {
      if (await ExaEnrichmentProvider.isAvailable()) {
        const supplement = await ExaEnrichmentProvider.enrichContact({
          personName: contact.person_name,
          companyName: contact.company_name,
          linkedinUrl: contact.linkedin_url ?? undefined,
          knownCompanySize,
          knownIndustry,
        })
        const merged = mergeEnrichment(result, supplement)
        result = merged.result
        enrichmentSources = merged.sources
      }
    } catch {
      // Exa unavailable/erroring — keep the primary result as-is.
    }
  }

  // Don't let a re-run's weaker/not-found enrichment clobber an already-good
  // one — see contact-update-guard.ts. Applies to whichever provider
  // produced this `result`, not just Prospeo.
  const existingEnrichment = contact.enrichment as EnrichmentResult | null
  const overwrite = shouldOverwriteEnrichment(
    contact.enrichment_status,
    existingEnrichment?.confidence,
    result.status,
    result.confidence
  )
  if (overwrite) {
    update.enrichment = result
    update.enrichment_status = result.status
    update.enrichment_provider = result.providerUsed
  }

  const { data: updated, error: updateError } = await supabase
    .from('outbound_contacts')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, contact: updated, result, overwriteBlocked: !overwrite, enrichmentSources })
}
