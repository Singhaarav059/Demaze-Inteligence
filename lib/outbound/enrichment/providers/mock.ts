// ============================================================
// Mock Contact Enrichment Provider
// ============================================================
// department/seniority/roleCategory are deterministically picked from small
// fixture arrays via seededPick(personName). companySize/industry prefer
// knownCompanySize/knownIndustry (real research data already sitting in
// pipeline_test_runs.final_result) over any invented fixture — this is the
// one mock that should ground itself in already-known data where it exists.
// ============================================================

import { seededPick, seededRatio } from '@/lib/outbound/shared/mock-utils'
import type { EnrichmentProvider, EnrichmentRequest, EnrichmentResult } from '../types'

const DEPARTMENTS = ['Operations', 'Engineering', 'Sales', 'Marketing', 'Finance', 'IT'] as const
const SENIORITIES = ['Individual Contributor', 'Manager', 'Director', 'VP', 'C-Suite'] as const
const ROLE_CATEGORIES = ['Technical', 'Commercial', 'Executive', 'Operational'] as const
const LOCATIONS = ['United States', 'India', 'United Kingdom', 'Germany', 'Singapore'] as const
const FALLBACK_INDUSTRIES = ['Manufacturing', 'Industrial Services', 'Technology', 'Financial Services'] as const
const FALLBACK_COMPANY_SIZES = ['11-50', '51-200', '201-1000', '1000+'] as const

export const MockEnrichmentProvider: EnrichmentProvider = {
  name: 'mock',
  displayName: 'Mock Contact Enrichment',

  async enrichContact(request: EnrichmentRequest): Promise<EnrichmentResult> {
    const { personName, companyName, linkedinUrl, knownCompanySize, knownIndustry } = request
    const seed = `${personName}::${companyName}`

    const notFoundRatio = seededRatio(`${seed}::not_found`)
    if (notFoundRatio >= 0.9) {
      return {
        confidence: 'low',
        providerUsed: 'mock',
        status: 'not_found',
      }
    }

    const department = seededPick(`${seed}::dept`, DEPARTMENTS)
    const seniority = seededPick(`${seed}::seniority`, SENIORITIES)
    const roleCategory = seededPick(`${seed}::role`, ROLE_CATEGORIES)
    const location = seededPick(`${seed}::location`, LOCATIONS)

    const companySize = knownCompanySize || seededPick(`${seed}::size`, FALLBACK_COMPANY_SIZES)
    const industry = knownIndustry || seededPick(`${seed}::industry`, FALLBACK_INDUSTRIES)

    const linkedinSummary = linkedinUrl
      ? `${personName} — ${seniority} in ${department} at ${companyName} (from provided LinkedIn URL).`
      : undefined

    const usedRealData = Boolean(knownCompanySize || knownIndustry)
    const confidence = usedRealData ? 'high' : 'medium'
    const status: EnrichmentResult['status'] = linkedinUrl ? 'enriched' : 'partial'

    return {
      department,
      seniority,
      location,
      roleCategory,
      linkedinSummary,
      companySize,
      industry,
      confidence,
      providerUsed: 'mock',
      status,
    }
  },

  async isAvailable(): Promise<boolean> {
    return true
  },
}
