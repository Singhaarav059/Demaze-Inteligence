// ============================================================
// buildSupplementedCompanyProfile() — website-primary, external-supplement
// ============================================================
// Covers the 2026-08-25 fix: buildCompanyProfile() inside extractSignals()
// was called with websiteContent only, while everything else there scanned
// website+enriched combined content — so a thin/degraded website scrape
// left primary_type 'unknown' even when the combined pool had clear
// classification evidence (confirmed on Bharat Forge, comparing
// benchmarks/debug/run-2026-08-24T09-36-50.json (PASS) vs
// benchmarks/debug/run-2026-08-25T03-52-20.json (FAIL, profileEvidence {})).
//
// Design (approved, not the naive "just always use combined" fix): the
// company's own site is the primary source for identity/classification —
// external content may only fill in fields the website left unestablished,
// never overwrite a classification the website already made.
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildCompanyProfile, buildSupplementedCompanyProfile } from '../lib/pipeline/evidence-extractor'

// Real bharatforge.com copy from the passing 2026-08-24 run's profileEvidence.
const BHARAT_FORGE_REAL_COPY = `
Bharat Forge Limited, part of the USD 3.5 billion Kalyani Group, is a global
leader in high-performance components across sectors such as Automotive,
Railways, Defence, Construction, Mining, Aerospace, Marine, and Oil & Gas.
With over half a century of manufacturing history, we have the largest
repository of metallurgical knowledge in the region.
`

const THIN_STUB_CONTENT = `Home | About | Contact | Careers`

const GENERIC_FILLER_CONTENT = `
Welcome to our website. We are committed to excellence and quality in
everything we do. Our team works hard every day to serve our customers.
Thank you for visiting.
`

const SAAS_CONFLICTING_CONTENT = `
Acme is a leading SaaS company offering a software-as-a-service platform
for subscription billing.
`

describe('buildSupplementedCompanyProfile', () => {
  // A. Website alone already establishes a real classification — output
  // must be identical to buildCompanyProfile(content) directly.
  it('A: matches buildCompanyProfile() directly when website content already classifies', () => {
    const direct = buildCompanyProfile(BHARAT_FORGE_REAL_COPY)
    const supplemented = buildSupplementedCompanyProfile(BHARAT_FORGE_REAL_COPY, undefined)
    expect(supplemented.profile.company_type).toEqual(direct.profile.company_type)
    expect(supplemented.profile.primary_type).toBe(direct.profile.primary_type)
  })

  // B. Thin website content + enriched content with valid manufacturer
  // evidence -> primary_type is no longer 'unknown'.
  it('B: thin website + valid enriched manufacturer evidence resolves primary_type', () => {
    const { profile } = buildSupplementedCompanyProfile(THIN_STUB_CONTENT, BHARAT_FORGE_REAL_COPY)
    expect(profile.primary_type).toBe('manufacturer')
    expect(profile.company_type.manufacturer).toBe(true)
  })

  // C. Strong website classification (manufacturer) + CONFLICTING enriched
  // evidence (SaaS) -> website classification wins, conflicting evidence
  // never appears in company_type/primary_type.
  it('C: website classification is never overridden by conflicting enriched evidence', () => {
    const { profile } = buildSupplementedCompanyProfile(BHARAT_FORGE_REAL_COPY, SAAS_CONFLICTING_CONTENT)
    expect(profile.primary_type).toBe('manufacturer')
    expect(profile.company_type.manufacturer).toBe(true)
    expect(profile.company_type.software_saas).toBe(false)
  })

  // D. Thin website + enriched content with no real classification evidence
  // -> primary_type stays 'unknown', no false positive.
  it('D: thin website + non-classifying enriched content stays unknown', () => {
    const { profile } = buildSupplementedCompanyProfile(THIN_STUB_CONTENT, GENERIC_FILLER_CONTENT)
    expect(profile.primary_type).toBe('unknown')
    expect(Object.values(profile.company_type).every((v) => v === false)).toBe(true)
  })

  // E. Reproduce the actual Bharat Forge bug signature: thin website stub,
  // enriched content carries the real classification phrases.
  it('E: reproduces the Bharat Forge fix — primary_type manufacturer from enriched content alone', () => {
    const { profile } = buildSupplementedCompanyProfile(THIN_STUB_CONTENT, BHARAT_FORGE_REAL_COPY)
    expect(profile.primary_type).toBe('manufacturer')
    expect(profile.company_type.manufacturer).toBe(true)
  })

  // F. Neither website nor enriched content has classification/operations
  // evidence -> stays unknown, no evidence manufactured.
  it('F: no evidence anywhere -> unknown, operations stay null/false', () => {
    const { profile } = buildSupplementedCompanyProfile(GENERIC_FILLER_CONTENT, GENERIC_FILLER_CONTENT)
    expect(profile.primary_type).toBe('unknown')
    expect(profile.operations.manufacturing_plants_count).toBeNull()
    expect(profile.operations.countries_present).toBeNull()
    expect(profile.operations.multi_location).toBe(false)
    expect(profile.operations.global_presence).toBe(false)
    expect(profile.operations.has_rd_center).toBe(false)
  })

  // Operations-supplement: website establishes manufacturer + primary_type
  // but states no facility count; enriched content states a count ->
  // manufacturing_plants_count gets filled in while classification stays
  // website-derived (supplement-without-override, for operations fields).
  it('operations: fills manufacturing_plants_count from enriched content without touching website-derived classification', () => {
    const websiteContent = `We are a leader in forgings and precision machining for the automotive sector.`
    const enrichedWithCount = `The company operates five manufacturing facilities across 3 countries.`

    const { profile } = buildSupplementedCompanyProfile(websiteContent, enrichedWithCount)

    expect(profile.company_type.manufacturer).toBe(true)
    expect(profile.primary_type).toBe('manufacturer')
    expect(profile.operations.manufacturing_plants_count).toBe(5)
    expect(profile.operations.countries_present).toBe(3)
  })
})
