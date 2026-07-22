// ============================================================
// Prospeo Contact Cache — shared-call orchestration
// ============================================================
// Email Finder and Contact Enrichment both call Prospeo's enrich-person
// endpoint for the same contact from two independent routes
// (find-email/route.ts, enrich/route.ts). This resolves ONE Prospeo
// response per contact and lets both routes derive their own result from
// it — a contact that's already been resolved by one route costs zero
// additional Prospeo credits when the other route runs.
//
// Deliberately scoped to the Prospeo provider only. This is NOT part of
// the EmailFinderProvider/EnrichmentProvider abstraction (lib/outbound/
// email-finder/types.ts, lib/outbound/enrichment/types.ts) — those stay
// generic for the mock provider and any future real vendor. Callers check
// getActiveProviderName() themselves and only use this module when both
// capabilities resolve to 'prospeo'; otherwise they fall back to the
// existing per-capability findEmail()/enrichContact() factory calls
// unchanged. See CLAUDE.md's 2026-07-21 cost-reduction session for why.
// ============================================================

import {
  getProspeoApiKey,
  callProspeoEnrichPerson,
  type ProspeoEnrichPersonResponse,
  type ProspeoCallResult,
} from './prospeo-client'

export interface ProspeoContactIdentity {
  personName: string
  companyName?: string
  domain?: string
  linkedinUrl?: string
}

export interface ResolvedProspeoPerson {
  result: ProspeoCallResult
  fromCache: boolean
}

/**
 * Resolves a Prospeo enrich-person response for a contact — reusing
 * `cachedRaw` (the contact's stored prospeo_raw column) when present,
 * otherwise making one live call. The live call intentionally omits
 * only_verified_email (unlike the Email Finder provider's own standalone
 * call) — dropping that flag means the single response is maximally useful
 * for BOTH email and enrichment interpretation, not just email lookup.
 *
 * Callers are responsible for persisting `result` back to prospeo_raw when
 * `fromCache` is false, so the NEXT capability to need this contact's data
 * gets a cache hit instead of a second paid call.
 */
export async function resolveProspeoPerson(
  identity: ProspeoContactIdentity,
  cachedRaw: ProspeoEnrichPersonResponse | null,
  capability: 'email_finder' | 'enrichment',
): Promise<ResolvedProspeoPerson | null> {
  if (cachedRaw) {
    return { result: { ok: true, data: cachedRaw }, fromCache: true }
  }

  const apiKey = await getProspeoApiKey(capability)
  if (!apiKey) return null

  const { personName, companyName, domain, linkedinUrl } = identity
  if (!personName?.trim() && !linkedinUrl) return null

  const result = await callProspeoEnrichPerson(apiKey, {
    data: linkedinUrl
      ? { linkedin_url: linkedinUrl }
      : {
          full_name: personName,
          company_website: domain || undefined,
          company_name: companyName || undefined,
        },
  })

  return { result, fromCache: false }
}
