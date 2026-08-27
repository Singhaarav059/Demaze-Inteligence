// ============================================================
// Evidence Extractor — buildCompanyProfile() industrial_vendor detection
// + the reader/customer-description guard (ATE Group audit fix)
// ============================================================
// Root cause (see docs/EPITAXY_VNEXT_AUDIT.md and the ATE Group
// classification audit): captureFlag(), which backs every company_type
// detector, had no subject awareness at all — a bare regex match counted
// identically whether the company was describing itself or the text was
// addressing the reader / a customer / a CSR beneficiary sector. Real
// false positive found live on ategroup.com: the industrial_vendor pattern
// matched "...or equipment manufacturer seeking a trusted counterpart..."
// inside a sentence addressing the READER, not describing ATE itself.
//
// isReaderOrCustomerDescribed() (evidence-extractor.ts) is a narrow,
// local-window guard now applied inside captureFlag() for every
// company_type category — these tests cover industrial_vendor directly,
// two already-known adjacent false positives (A-1 Fence Products' CSR
// mention, AITG's founder-history anecdote), and a non-regression check
// for Ador Welding's industrial_vendor_manufacturer hybrid.
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildCompanyProfile } from '../lib/pipeline/evidence-extractor'

describe('buildCompanyProfile — industrial_vendor detection', () => {
  it('still matches a genuine first-person vendor description', () => {
    const content = `We supply welding equipment, consumables, and automation solutions to manufacturers worldwide.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.industrial_vendor).toBe(true)
  })

  it('still matches genuine third-person vendor self-description (company name, not "we/our")', () => {
    const content = `Ador has been manufacturing high-quality welding equipment, consumables, and welding automation solutions for decades.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.industrial_vendor).toBe(true)
  })

  // ── The exact real-world false positive (ategroup.com) ───────────────
  it('does NOT set industrial_vendor from the real ategroup.com reader-addressed sentence', () => {
    const content = `WITH ATE If you are a technology provider or equipment manufacturer seeking a trusted counterpart with deep domain expertise, we would love to talk.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.industrial_vendor).toBe(false)
    expect(profile.company_type.manufacturer).toBe(false)
  })

  it('does NOT set industrial_vendor from a customer/partner description ("our customers include equipment manufacturers")', () => {
    const content = `Our customers include equipment manufacturers, welding contractors, and industrial fabricators across the region.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.industrial_vendor).toBe(false)
  })

  it('does NOT set industrial_vendor from a case-study framing', () => {
    const content = `Case study: how one of our clients, a welding equipment manufacturer, cut downtime by 30% using our platform.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.industrial_vendor).toBe(false)
  })
})

describe('buildCompanyProfile — CSR/generic-context false positives (audit-flagged, adjacent to the industrial_vendor bug)', () => {
  // Real A-1 Fence Products false positive: a CSR section listing
  // unrelated beneficiary sectors ("rural development, water and
  // sanitation, healthcare services") previously set
  // company_type.healthcare_provider = true, even though A-1 Fence is a
  // fencing manufacturer, not a healthcare provider. Ordering already kept
  // this from corrupting primary_type, but the flag itself was still wrong.
  it('does NOT set healthcare_provider from a CSR-section mention of "healthcare services" — real content shape: heading follows the sentence, not inside it', () => {
    // Mirrors the actual a-1fenceproducts.com scrape verbatim in shape:
    // "...water and sanitation, healthcare services. ## CSR INITIATIVES...".
    // The CSR heading comes AFTER the sentence containing the keyword, not
    // inside it — this is exactly why isCsrContext() checks the raw local
    // snippet, not the sentence-scoped window (a first attempt at this fix
    // used sentence-scoping for CSR too and missed this real case, since
    // the period before "## CSR INITIATIVES" ends the sentence right there).
    const content = `Our activities support rural development, water and sanitation, healthcare services. ## CSR INITIATIVES * * * Some of the successful CSR programs include education and skill development.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.healthcare_provider).toBe(false)
  })

  it('still correctly classifies A-1 Fence Products as a manufacturer despite the CSR mention, with realistic separation between the two sections', () => {
    const content = `A-1 Fence's operations are spread over six manufacturing units across India, serving infrastructure and defence customers nationwide with quality fencing solutions engineered to last for decades in demanding field conditions. Our activities also support rural development, water and sanitation, healthcare services. ## CSR INITIATIVES * * * Some of the successful CSR programs include education and skill development.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
    expect(profile.company_type.healthcare_provider).toBe(false)
    expect(profile.primary_type).toBe('manufacturer')
  })

  // AITG's real false positive is a founder-history anecdote ("Nanasaheb
  // chanced upon many imported hospital equipment lying unused... He
  // offered to repair it") — NOT reader-address, customer/partner
  // description, or CSR content. It's a distinct root cause (the
  // healthcare_provider patterns are bare keyword matches with no context
  // requirement at all — a pre-existing, separately-flagged gap, not part
  // of the reader/customer-description bug this fix targets) and is
  // deliberately NOT fixed here — see the audit report's "remaining
  // issues". This test documents current, unchanged behavior rather than
  // asserting a fix that isn't part of this change.
  it('[known remaining gap, not fixed by this change] AITG-style founder-history anecdote still sets healthcare_provider — third-person biographical narrative, not reader/customer/CSR framing', () => {
    const content = `Nanasaheb chanced upon many imported hospital equipment lying unused due to failure. He offered to repair it, and that experience shaped the group's engineering focus.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.healthcare_provider).toBe(true)
  })
})

describe('buildCompanyProfile — non-regression: Ador Welding hybrid classification', () => {
  it('still resolves to industrial_vendor_manufacturer for genuine dual manufacturer + vendor evidence', () => {
    const content = `"," Ador produces world-class products across six manufacturing facilities nationwide. One of the largest engineering companies in India, manufacturing high-quality welding equipment, consumables, and welding automation solutions.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
    expect(profile.company_type.industrial_vendor).toBe(true)
    expect(profile.primary_type).toBe('industrial_vendor_manufacturer')
  })
})
