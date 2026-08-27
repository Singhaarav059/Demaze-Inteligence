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

  // ── Subsidiary/brand-attributed manufacturing (ATE Group audit fix) ──
  // Real gap found on ategroup.com: a group/holding company describes its
  // own manufacturing in the third person, named by brand/subsidiary, not
  // "we/our" — none of the patterns above covered this construction.
  it('detects third-person subsidiary/brand manufacturing ("Brand manufactures high-quality X")', () => {
    const content = `AxisValence manufactures high-quality equipment that enhances safety, productivity, and environmental performance across a wide range of industries.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
  })

  it('detects a different brand name with a different qualifying adjective', () => {
    const content = `TeraSpin manufactures precision components for leading textile machinery manufacturers and mills worldwide.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
  })

  it('does NOT match a bare "X manufactures Y" with no qualifying adjective (generic-mention guard)', () => {
    const content = `Ford manufactures cars and trucks for the North American market.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(false)
  })

  // ── Reader/customer-description guard (ATE Group audit fix) ──────────
  // Real false positive found live on ategroup.com: the industrial_vendor
  // pattern matched "...or equipment manufacturer seeking a trusted
  // counterpart..." inside a sentence addressing the READER, not
  // describing the company itself.
  it('does NOT set manufacturer/industrial_vendor from reader-addressed "if you are an equipment manufacturer..."', () => {
    const content = `If you are a technology provider or equipment manufacturer seeking a trusted counterpart with deep domain expertise, talk to us.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(false)
    expect(profile.company_type.industrial_vendor).toBe(false)
  })

  it('does NOT set manufacturer/industrial_vendor from reader-addressed "if you are a distributor..."', () => {
    const content = `If you are a distributor or equipment manufacturer looking for a partner, we would love to hear from you.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(false)
    expect(profile.company_type.industrial_vendor).toBe(false)
  })

  it('does NOT set manufacturer from "your manufacturing facility" (reader-identity framing) — without the guard, "manufactur* + facilit*" would otherwise fire', () => {
    const content = `Wondering if your manufacturing facility could run more efficiently? Our software platform can help you find out.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(false)
  })

  // Explicit non-regression: a bare "you"/"your" mention must NOT reject a
  // genuine company self-description — the company is still clearly the
  // sentence's actor here.
  it('still matches genuine self-description that happens to mention "your" ("we manufacture... for your industry")', () => {
    const content = `We manufacture precision components engineered for your industry's toughest demands.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
  })
})
