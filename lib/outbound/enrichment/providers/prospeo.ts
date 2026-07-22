// ============================================================
// Prospeo Contact Enrichment Provider
// ============================================================
// Calls the same Prospeo enrich-person endpoint as the Email Finder
// provider, but without only_verified_email — we want whatever profile
// data Prospeo has even if no verified email comes back. Prefers a
// linkedin_url match (highest precision Prospeo supports) over
// full_name+company when a LinkedIn URL is available. Falls back to the
// request's knownCompanySize/knownIndustry hints (pulled from this
// platform's own research) only when Prospeo's own company data is thin —
// Prospeo's live data is more authoritative than our own guess when present.
// ============================================================

import { getProspeoApiKey, callProspeoEnrichPerson, type ProspeoCallResult } from '@/lib/outbound/shared/prospeo-client'
import type { EnrichmentProvider, EnrichmentRequest, EnrichmentResult } from '../types'

export interface EnrichmentHints {
  knownCompanySize?: string
  knownIndustry?: string
}

// Pure interpreter — derives an EnrichmentResult from any Prospeo
// enrich-person response, whether freshly fetched by this provider or
// reused from a shared/cached response the Email Finder provider (or a
// prior call) already fetched. Extracted (2026-07-21) for the same reason
// as interpretProspeoEmailResult in the email-finder provider — see
// prospeo-contact-cache.ts.
export function interpretProspeoEnrichmentResult(
  result: ProspeoCallResult,
  hints: EnrichmentHints = {}
): EnrichmentResult {
  if (!result.ok || result.data.error || !result.data.person) {
    return { confidence: 'low', providerUsed: 'prospeo', status: 'not_found' }
  }

  const { person, company } = result.data
  const currentJob = person.job_history?.find(j => j.current) ?? person.job_history?.[0]
  const location = [person.location?.city, person.location?.state, person.location?.country]
    .filter(Boolean)
    .join(', ')

  const companySize = company?.employee_range || hints.knownCompanySize
  const industry = company?.industry || hints.knownIndustry
  const hasSubstance = Boolean(currentJob?.seniority || industry || person.headline)

  return {
    department: currentJob?.departments?.[0],
    seniority: currentJob?.seniority,
    location: location || undefined,
    roleCategory: person.current_job_title ?? currentJob?.title,
    linkedinSummary: person.headline,
    companySize,
    industry,
    confidence: !hasSubstance ? 'low' : currentJob?.seniority && industry ? 'high' : 'medium',
    providerUsed: 'prospeo',
    status: hasSubstance ? 'enriched' : 'partial',
  }
}

export const ProspeoEnrichmentProvider: EnrichmentProvider = {
  name: 'prospeo',
  displayName: 'Prospeo',

  async enrichContact(request: EnrichmentRequest): Promise<EnrichmentResult> {
    const { personName, companyName, linkedinUrl, knownCompanySize, knownIndustry } = request

    if (!personName?.trim() && !linkedinUrl) {
      return { confidence: 'low', providerUsed: 'prospeo', status: 'not_found' }
    }

    const apiKey = await getProspeoApiKey('enrichment')
    if (!apiKey) {
      return { confidence: 'low', providerUsed: 'prospeo', status: 'not_found' }
    }

    const result = await callProspeoEnrichPerson(apiKey, {
      data: linkedinUrl
        ? { linkedin_url: linkedinUrl }
        : { full_name: personName, company_name: companyName || undefined },
    })

    return interpretProspeoEnrichmentResult(result, { knownCompanySize, knownIndustry })
  },

  // Cheap credential-presence check only — no network ping before every
  // request, same discipline as the other real providers in this repo.
  async isAvailable(): Promise<boolean> {
    return (await getProspeoApiKey('enrichment')) !== null
  },
}
