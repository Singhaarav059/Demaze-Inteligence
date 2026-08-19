// ============================================================
// Evidence Ledger (G2) — regression tests
// ============================================================
// Covers docs/evidence-ledger-design.md's canonical EvidenceItem, source
// authority tiering, freshness, company-identity confidence, contradiction
// detection, and the full SOURCE -> EVIDENCE -> PAIN POINT/OPPORTUNITY ->
// PERSONALIZATION -> EMAIL propagation chain. Uses real production
// functions throughout (normalizeAnalysisResult, buildEmailGenerationInput,
// buildSubjectLinePrompt, checkUnsupportedClaims), not reimplementations.

import { describe, it, expect } from 'vitest'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'
import {
  classifySourceAuthority,
  classifyFreshness,
  computeCompanyIdentityConfidence,
  computeEvidenceConfidence,
  attributeQuoteToSource,
} from '../lib/pipeline/evidence-ledger'
import { buildEmailGenerationInput } from '../lib/outbound/generation/assemble-input'
import { buildSubjectLinePrompt } from '../lib/outbound/generation/prompts'
import { checkUnsupportedClaims } from '../lib/outbound/generation/claim-grounding'

// ── Fixtures ────────────────────────────────────────────────────────────
const OPS_PAGE = 'Our team is currently implementing a new centralized reporting system across all six plants.'
const INVESTOR_PAGE = 'Despite recent investments, the reporting system remains manual, and plants still submit data by fax each week.'
const SINGLE_PAGE_CONTENT =
  `--- PAGE: /operations (https://example.com/operations) ---\n${OPS_PAGE}`
const CONFLICTING_CONTENT =
  `--- PAGE: /operations (https://example.com/operations) ---\n${OPS_PAGE}\n\n` +
  `--- PAGE: /investor-update (https://example.com/investor-update) ---\n${INVESTOR_PAGE}`
const OPS_QUOTE = 'implementing a new centralized reporting system across all six plants'
const INVESTOR_QUOTE = 'the reporting system remains manual, and plants still submit data by fax each week'

function baseRaw(overrides: Record<string, unknown>, extractorOverrides: Record<string, unknown> = {}) {
  return {
    company_name: 'Test Co',
    _extractor: {
      companySubjectCount: 3,
      signals: [{ signal: 'growth' }],
      leadershipContacts: [],
      websitePreview: SINGLE_PAGE_CONTENT,
      ...extractorOverrides,
    },
    ...overrides,
  }
}

describe('evidence-ledger — pure functions', () => {
  // 5. stale evidence
  it('classifies a >3-year-old publish date as stale', () => {
    expect(classifyFreshness('2019-01-01')).toBe('stale')
  })

  // 6. missing publication date — never invents one
  it('classifies a missing publish date as unknown, not a fabricated bucket', () => {
    expect(classifyFreshness(null)).toBe('unknown')
    expect(classifyFreshness(undefined)).toBe('unknown')
  })

  // 4. unrelated company evidence
  it('scores company-identity confidence low when the quote does not mention the company', () => {
    expect(computeCompanyIdentityConfidence('a completely unrelated sentence', 'Acme Corp')).toBe('low')
    expect(computeCompanyIdentityConfidence('Acme Corp operates six plants', 'Acme Corp')).toBe('high')
    expect(computeCompanyIdentityConfidence('some text', undefined)).toBe('unknown')
  })

  // 9. search snippet / generic source not treated as strong proof
  it('classifies an unrecognized source type as weak authority, not first-party', () => {
    expect(classifySourceAuthority('other')).toBe('weak')
    expect(classifySourceAuthority(undefined)).toBe('unknown')
    expect(classifySourceAuthority('regulatory_filing')).toBe('regulatory')
    expect(classifySourceAuthority('annual_report')).toBe('first_party')
  })

  // 8. primary source outranks secondary/weak source, all else equal
  it('scores a first-party, identity-confirmed, observed claim higher than a weak, unattributed one', () => {
    const strong = computeEvidenceConfidence({
      sourceAuthority: 'first_party', companyIdentityConfidence: 'high', claimType: 'observed', freshness: 'unknown', contradictionStatus: 'none',
    })
    const weak = computeEvidenceConfidence({
      sourceAuthority: 'weak', companyIdentityConfidence: 'unknown', claimType: 'observed', freshness: 'unknown', contradictionStatus: 'none',
    })
    expect(strong).toBeGreaterThan(weak)
  })

  // 3. unsupported hypothesis scores below an inference, which scores below an observed fact
  it('scores hypothesis < inferred < observed on directness, all else equal', () => {
    const base = { sourceAuthority: 'weak' as const, companyIdentityConfidence: 'unknown' as const, freshness: 'unknown' as const, contradictionStatus: 'none' as const }
    const observed = computeEvidenceConfidence({ ...base, claimType: 'observed' })
    const inferred = computeEvidenceConfidence({ ...base, claimType: 'inferred' })
    const hypothesis = computeEvidenceConfidence({ ...base, claimType: 'hypothesis' })
    expect(observed).toBeGreaterThan(inferred)
    expect(inferred).toBeGreaterThan(hypothesis)
  })

  it('attributes a verified quote to its real source URL, or honestly returns null when unattributable', () => {
    const real = attributeQuoteToSource(OPS_QUOTE, undefined, SINGLE_PAGE_CONTENT)
    expect(real.sourceUrl).toBe('https://example.com/operations')
    expect(real.sourceType).toBe('corporate_website')

    const noHeader = attributeQuoteToSource('some quote', undefined, 'plain content with no page markers at all')
    expect(noHeader.sourceUrl).toBeNull()
    expect(noHeader.sourceType).toBe('unknown')
  })
})

describe('evidence-ledger — normalizeAnalysisResult integration', () => {
  // 1. confirmed company fact -> real, attributed evidence_ledger entry
  it('builds a real, attributed EvidenceItem for an observed pain point quote', () => {
    const result = normalizeAnalysisResult(baseRaw({
      pain_points: [{
        title: 'Fragmented plant-level reporting',
        claim_type: 'observed',
        evidence: OPS_QUOTE,
        confidence: 'high',
        reasoning: 'x',
      }],
    }))
    expect(result.evidence_ledger.length).toBeGreaterThan(0)
    const entry = result.evidence_ledger[0]
    expect(entry.claimType).toBe('observed')
    expect(entry.sourceUrl).toBe('https://example.com/operations')
    expect(entry.sourceAuthority).toBe('first_party')
    expect(entry.freshness).toBe('unknown') // no publish date extraction wired in yet, honest not fabricated
  })

  // 2. reasonable inference — no ledger entry built (no quote to attribute), stays correctly labeled
  it('does not build a ledger entry for an inferred claim, and does not break its existing labeling', () => {
    const result = normalizeAnalysisResult(baseRaw({
      pain_points: [{
        title: 'Likely lacks unified cross-plant reporting',
        claim_type: 'inferred',
        evidence: 'Multi-plant operations typically face this without a dedicated system',
        confidence: 'medium',
        reasoning: 'x',
      }],
    }))
    expect(result.pain_points_structured[0].claim_type).toBe('inferred')
    expect(result.evidence_ledger).toEqual([])
  })

  // 10 + 11. evidence surviving normalization AND persistence (id round-trips)
  it('links a pain point to a real evidence_ledger entry via supportingEvidenceIds', () => {
    const result = normalizeAnalysisResult(baseRaw({
      pain_points: [{
        title: 'Fragmented plant-level reporting',
        claim_type: 'observed',
        evidence: OPS_QUOTE,
        confidence: 'high',
        reasoning: 'x',
      }],
    }))
    const pp = result.pain_points_structured[0]
    expect(pp.supportingEvidenceIds?.length).toBe(1)
    const linkedId = pp.supportingEvidenceIds![0]
    expect(result.evidence_ledger.some(e => e.id === linkedId)).toBe(true)
  })

  // 12. evidence reaching an opportunity (Path B1, llm_verified)
  it('links an llm_verified opportunity to a real evidence_ledger entry', () => {
    const result = normalizeAnalysisResult(baseRaw({
      opportunities: [{
        title: 'Centralized plant reporting rollout',
        description: 'x',
        claim_type: 'observed',
        evidence: OPS_QUOTE,
        service_line: 'AI-powered business applications',
        opportunity_confidence: 'medium',
      }],
    }))
    const opp = result.opportunities.find(o => o.source === 'llm_verified')
    expect(opp).toBeTruthy()
    expect(opp!.supportingEvidenceIds?.length).toBe(1)
    expect(result.evidence_ledger.some(e => e.id === opp!.supportingEvidenceIds![0])).toBe(true)
  })

  // 7. contradictory evidence — flagged, not silently dropped, dependent claims downgraded
  it('flags two contradicting observed pain points and downgrades both to low confidence', () => {
    const result = normalizeAnalysisResult(baseRaw({
      pain_points: [
        { title: 'Centralizing plant reporting', claim_type: 'observed', evidence: OPS_QUOTE, confidence: 'high', reasoning: 'x' },
        { title: 'Reporting still manual', claim_type: 'observed', evidence: INVESTOR_QUOTE, confidence: 'high', reasoning: 'x' },
      ],
    }, { websitePreview: CONFLICTING_CONTENT }))
    expect(result.evidence_ledger).toHaveLength(2)
    expect(result.evidence_ledger.every(e => e.contradictionStatus === 'conflict')).toBe(true)
    // neither side silently dropped
    expect(result.pain_points_structured).toHaveLength(2)
    expect(result.pain_points_structured.every(p => p.confidence === 'low')).toBe(true)
  })
})

describe('evidence propagation to email generation (existing gates, confirmed not weakened)', () => {
  // 13. evidence (claim_type) reaching the assembled email-generation input
  it('carries claim_type from a normalized pain point into EmailGenerationInput', () => {
    const result = normalizeAnalysisResult(baseRaw({
      pain_points: [{
        title: 'Likely lacks unified cross-plant reporting',
        claim_type: 'inferred',
        evidence: 'Multi-plant operations typically face this without a dedicated system',
        confidence: 'medium',
        reasoning: 'x',
      }],
    }))
    const input = buildEmailGenerationInput(
      { person_name: 'Jane Doe', title_hint: 'VP Ops', company_name: 'Test Co' },
      result as unknown as Record<string, unknown>,
    )
    expect(input.painPointsDetailed?.[0]?.claimType).toBe('inferred')
  })

  // 14. inferred claim receives qualified/hedged wording in the actual prompt text
  it('renders an inferred pain point with the "(unconfirmed inference)" hedging tag in the real prompt', () => {
    const { userPrompt } = buildSubjectLinePrompt({
      personName: 'Jane Doe',
      companyName: 'Test Co',
      painPoints: ['Likely lacks unified cross-plant reporting'],
      painPointsDetailed: [{ text: 'Likely lacks unified cross-plant reporting', claimType: 'inferred' }],
      opportunities: [],
      recentActivity: [],
    })
    expect(userPrompt).toContain('(unconfirmed inference)')
  })

  // 15. unsupported numeric claim is blocked
  it('flags a generated-email number that does not trace back to any given evidence', () => {
    const input = {
      personName: 'Jane Doe',
      companyName: 'Acme Corp',
      companySummary: 'Acme Corp operates two facilities.',
      painPoints: [],
      opportunities: [],
      recentActivity: [],
    }
    const result = checkUnsupportedClaims(
      'I saw that Acme Corp operates 12 facilities across the region, which seems like a lot to coordinate.',
      input,
    )
    expect(result.hasUnsupportedClaim).toBe(true)
  })
})
