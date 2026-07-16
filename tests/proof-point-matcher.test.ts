// ============================================================
// Proof Point Matcher — matching/scoring/empty-fit
// ============================================================
// Covers matchProofPoints() (lib/knowledge/proof-point-matcher.ts): pure,
// network-free industry-tag matching against the static
// DEMAZE_PROOF_POINTS catalog. No search calls to mock — same reasoning
// as tests/icp-generator.test.ts only covering the pure pieces.

import { describe, it, expect } from 'vitest'
import { matchProofPoints, detectIndustryTags } from '../lib/knowledge/proof-point-matcher'
import type { CompanyProfile } from '../lib/pipeline/evidence-extractor'

function emptyCompanyProfile(): CompanyProfile {
  return {
    company_type: {
      manufacturer: false, industrial_vendor: false, software_saas: false,
      services_provider: false, retailer: false, logistics_operator: false,
      financial_institution: false, healthcare_provider: false,
      pharma_biotech: false, conglomerate: false,
    },
    operations: {
      multi_location: false, global_presence: false, has_rd_center: false,
      manufacturing_plants_count: null, countries_present: null,
    },
    capabilities: { has_robotics_or_automation: false, has_software_platform: false },
    selling_model: {
      sells_to_industry: false, sells_to_consumers: false,
      sells_physical_product: false, sells_software: false, sells_services: false,
    },
    primary_type: 'unknown',
  }
}

describe('detectIndustryTags — signal detection', () => {
  it('detects automotive from dealership/OEM keywords', () => {
    const tags = detectIndustryTags('We operate a multi-brand dealership network serving OEM partners.', emptyCompanyProfile())
    expect(tags.has('automotive')).toBe(true)
  })

  it('detects manufacturing from the manufacturer company_type flag', () => {
    const profile = { ...emptyCompanyProfile(), company_type: { ...emptyCompanyProfile().company_type, manufacturer: true } }
    const tags = detectIndustryTags('Generic content with no keywords.', profile)
    expect(tags.has('manufacturing')).toBe(true)
    expect(tags.has('industrial')).toBe(true)
  })

  it('detects fintech from the financial_institution company_type flag', () => {
    const profile = { ...emptyCompanyProfile(), company_type: { ...emptyCompanyProfile().company_type, financial_institution: true } }
    const tags = detectIndustryTags('Generic content.', profile)
    expect(tags.has('fintech')).toBe(true)
  })

  it('returns an empty set for content and profile with no signal at all', () => {
    const tags = detectIndustryTags('Nothing relevant here.', emptyCompanyProfile())
    expect(tags.size).toBe(0)
  })

  it('combines keyword and company_type signals from both sources', () => {
    const profile = { ...emptyCompanyProfile(), company_type: { ...emptyCompanyProfile().company_type, retailer: true } }
    const tags = detectIndustryTags('We run an online marketplace for D2C brand partners.', profile)
    expect(tags.has('ecommerce')).toBe(true) // from both the keyword AND the retailer flag
  })
})

describe('matchProofPoints — ranking and empty-fit', () => {
  it('returns [] when nothing scores (honest empty fit, no forced match)', () => {
    const result = matchProofPoints('Completely unrelated content about gardening tips.', emptyCompanyProfile())
    expect(result).toEqual([])
  })

  it('matches automotive dealership content to an automotive proof point', () => {
    const result = matchProofPoints('We are a multi-brand automotive dealership group with OEM partnerships.', emptyCompanyProfile())
    expect(result.length).toBeGreaterThan(0)
    expect(result.every(pp => pp.industry_tags.includes('automotive'))).toBe(true)
  })

  it('matches manufacturer company_type to a manufacturing proof point', () => {
    const profile = { ...emptyCompanyProfile(), company_type: { ...emptyCompanyProfile().company_type, manufacturer: true } }
    const result = matchProofPoints('We run production plants across the country.', profile)
    expect(result.length).toBeGreaterThan(0)
    expect(result.every(pp => pp.industry_tags.some(t => t === 'manufacturing' || t === 'industrial'))).toBe(true)
  })

  it('ranks named_client proof points ahead of composite_illustrative ones on a tie', () => {
    // Automotive has both named_client (Volvo/Mercedes) and composite_illustrative entries.
    const result = matchProofPoints('Automotive dealership network, OEM certified.', emptyCompanyProfile(), 10)
    const firstNamedIndex = result.findIndex(pp => pp.provenance === 'named_client')
    const firstCompositeIndex = result.findIndex(pp => pp.provenance === 'composite_illustrative')
    expect(firstNamedIndex).toBeGreaterThanOrEqual(0)
    expect(firstCompositeIndex).toBeGreaterThanOrEqual(0)
    expect(firstNamedIndex).toBeLessThan(firstCompositeIndex)
  })

  it('respects the maxResults cap', () => {
    const result = matchProofPoints('Automotive dealership network, OEM certified, manufacturing plant operations.', emptyCompanyProfile(), 1)
    expect(result.length).toBeLessThanOrEqual(1)
  })

  it('defaults to capping at 2 results', () => {
    const result = matchProofPoints('Automotive dealership network, OEM certified, manufacturing plant operations, distributor network.', emptyCompanyProfile())
    expect(result.length).toBeLessThanOrEqual(2)
  })

  it('every returned proof point actually shares at least one tag with the detected set', () => {
    const profile = { ...emptyCompanyProfile(), company_type: { ...emptyCompanyProfile().company_type, financial_institution: true } }
    const detected = detectIndustryTags('Trading platform for algorithmic trading.', profile)
    const result = matchProofPoints('Trading platform for algorithmic trading.', profile, 10)
    for (const pp of result) {
      expect(pp.industry_tags.some(t => detected.has(t))).toBe(true)
    }
  })
})
