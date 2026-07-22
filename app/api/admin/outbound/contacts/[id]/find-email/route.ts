// ============================================================
// Admin: Find Email — POST /api/admin/outbound/contacts/[id]/find-email
// ============================================================
// Runs the active Email Finder provider against this contact's
// person_name + company_domain and persists the result.
//
// When the active provider (for both email_finder AND enrichment) is
// Prospeo, this shares ONE Prospeo call with the /enrich route instead of
// each route paying for its own — see lib/outbound/shared/
// prospeo-contact-cache.ts. Any other provider (mock, or a future non-
// Prospeo vendor) is unaffected and goes through the original
// findEmail() factory path unchanged.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { findEmail } from '@/lib/outbound/email-finder/provider-factory'
import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import { resolveProspeoPerson } from '@/lib/outbound/shared/prospeo-contact-cache'
import { interpretProspeoEmailResult } from '@/lib/outbound/email-finder/providers/prospeo'
import { interpretProspeoEnrichmentResult } from '@/lib/outbound/enrichment/providers/prospeo'
import type { ProspeoEnrichPersonResponse } from '@/lib/outbound/shared/prospeo-client'
import type { EmailFinderResult } from '@/lib/outbound/email-finder/types'

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
    .select('id, person_name, company_name, company_domain, linkedin_url, enrichment_status, prospeo_raw')
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

  const [emailFinderProvider, enrichmentProvider] = await Promise.all([
    getActiveProviderName('email_finder'),
    getActiveProviderName('enrichment'),
  ])

  let result: EmailFinderResult
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (emailFinderProvider === 'prospeo') {
    const resolved = await resolveProspeoPerson(
      {
        personName: contact.person_name,
        companyName: contact.company_name,
        domain: contact.company_domain,
        linkedinUrl: contact.linkedin_url ?? undefined,
      },
      (contact.prospeo_raw as ProspeoEnrichPersonResponse | null) ?? null,
      'email_finder',
    )

    if (!resolved) {
      // No API key configured / no identity to match against — fall through
      // to the abstracted factory call so the error message matches the
      // provider's own "no key configured" text instead of a generic one.
      result = await findEmail({
        personName: contact.person_name,
        companyName: contact.company_name,
        domain: contact.company_domain,
      })
    } else {
      result = interpretProspeoEmailResult(resolved.result)

      if (!resolved.fromCache && resolved.result.ok) {
        update.prospeo_raw = resolved.result.data
        update.prospeo_fetched_at = new Date().toISOString()
      }

      // Opportunistically backfill enrichment too — this single response
      // already carries everything the /enrich route would otherwise pay a
      // second Prospeo credit to fetch separately.
      if (contact.enrichment_status === 'pending' && enrichmentProvider === 'prospeo' && resolved.result.ok) {
        const enrichmentResult = interpretProspeoEnrichmentResult(resolved.result)
        update.enrichment = enrichmentResult
        update.enrichment_status = enrichmentResult.status
        update.enrichment_provider = enrichmentResult.providerUsed
      }
    }
  } else {
    result = await findEmail({
      personName: contact.person_name,
      companyName: contact.company_name,
      domain: contact.company_domain,
    })
  }

  update.email = result.email
  update.email_confidence = result.confidence
  update.email_finder_provider = result.providerUsed
  update.email_finder_status = result.status

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
