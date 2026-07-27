// ============================================================
// Evidence Extractor — buildCompanyProfile() manufacturer detection
// ============================================================
// Covers the 2026-07-27 fix: re-verifying a benchmark FAIL for Bharat
// Forge (profile_flag:manufacturer=false, primary_type=unknown) found the
// real, current bharatforge.com homepage copy contains genuine, strong
// manufacturer-describing language that none of the existing `manufacturer`
// regex patterns covered — not a scraping problem (the homepage scraped
// cleanly, 5000 real chars) and not flakiness, a real regex coverage gap:
//
//   "...is a global leader in high-performance components across sectors
//   such as Automotive, Railways, Defence... With over half a century of
//   manufacturing history, we have the largest repository of metallurgical
//   knowledge..."
//
// Two new patterns close this gap. This is buildCompanyProfile()'s first
// dedicated test file — no prior coverage existed for this function at all.
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildCompanyProfile } from '../lib/pipeline/evidence-extractor'

describe('buildCompanyProfile — manufacturer detection', () => {
  it('detects "leader in high-performance components" (real bharatforge.com copy, 2026-07-27)', () => {
    const content = `
Bharat Forge Limited, part of the USD 3.5 billion Kalyani Group, is a global
leader in high-performance components across sectors such as Automotive,
Railways, Defence, Construction, Mining, Aerospace, Marine, and Oil & Gas.
`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
  })

  it('detects "N years/decades/century of manufacturing" (real bharatforge.com copy, 2026-07-27)', () => {
    const content = `
With over half a century of manufacturing history, we have the largest
repository of metallurgical knowledge in the region.
`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
  })

  it('detects both patterns together on the real, full homepage excerpt', () => {
    const content = `
Bharat Forge Limited, part of the USD 3.5 billion Kalyani Group, is a global
leader in high-performance components across sectors such as Automotive,
Railways, Defence, Construction, Mining, Aerospace, Marine, and Oil & Gas.
With over half a century of manufacturing history, we have the largest
repository of metallurgical knowledge in the region. Providing end-to-end
solutions including concept to product design, we also offer engineering,
manufacturing, testing, and validation.
`
    const { profile, evidence } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
    expect(profile.primary_type).toBe('manufacturer')
    expect(evidence.manufacturer?.length).toBeGreaterThanOrEqual(2)
  })

  // "leader in components"/"leader in products" alone is too generic — a
  // SaaS or services company could plausibly say either. The qualifier
  // requirement (precision/high-performance/engineered) is what keeps this
  // extension from becoming an anti-pattern (see CLAUDE.md's "generic
  // industry label, not a sales-useful signal" warning).
  it('does NOT match bare "leader in components" without a qualifying adjective (false-positive guard)', () => {
    const content = `We are a leader in components and services for our customers worldwide.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(false)
  })

  it('does NOT match "leader in products" — deliberately too generic to be manufacturer-specific', () => {
    const content = `Acme is the leader in products for the retail industry.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(false)
  })

  // Non-regression: the original noun list (forgings/castings/stampings/
  // machining/fabrication/manufactur*) must still match unchanged.
  it('non-regression: "leader in forgings" (original pattern) still matches', () => {
    const content = `The company is a leader in forgings and precision machining for the automotive sector.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
  })

  it('does NOT match an unrelated "years of X" phrase that has nothing to do with manufacturing', () => {
    const content = `With over 20 years of customer service experience, we pride ourselves on support quality.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(false)
  })
})
