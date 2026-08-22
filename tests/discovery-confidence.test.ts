import { describe, it, expect } from 'vitest'
import { scoreDiscoveryCandidate } from '../lib/enrichment/discovery-confidence'

const BASE = {
  entityType: 'COMPANY' as const,
  isDuplicateOrAlreadyClaimed: false,
  sectorSignalMatch: 'match' as const,
  sizeVerdict: 'within_range' as const,
  domainConfirmed: true,
  domainConfidence: 'high' as const,
  mentionCount: 2,
}

describe('scoreDiscoveryCandidate — hard gates short-circuit regardless of other signals', () => {
  it('a duplicate is REJECTED/0 even with every other signal strong', () => {
    const result = scoreDiscoveryCandidate({ ...BASE, isDuplicateOrAlreadyClaimed: true })
    expect(result.verdict).toBe('REJECTED')
    expect(result.score).toBe(0)
  })

  it('a non-COMPANY entity type is REJECTED/0 even with a confirmed domain and sector match', () => {
    const result = scoreDiscoveryCandidate({ ...BASE, entityType: 'ASSOCIATION' })
    expect(result.verdict).toBe('REJECTED')
    expect(result.score).toBe(0)
  })

  it('a mega-scale (too_large) size verdict is REJECTED/0 — the literal "Ford qualifies because automotive" failure mode', () => {
    const result = scoreDiscoveryCandidate({ ...BASE, sizeVerdict: 'too_large' })
    expect(result.verdict).toBe('REJECTED')
    expect(result.score).toBe(0)
  })

  it('too_small is also a hard REJECTED gate', () => {
    const result = scoreDiscoveryCandidate({ ...BASE, sizeVerdict: 'too_small' })
    expect(result.verdict).toBe('REJECTED')
  })

  it('a confirmed sector mismatch (no_match, not just no evidence) is REJECTED', () => {
    const result = scoreDiscoveryCandidate({ ...BASE, sectorSignalMatch: 'no_match' })
    expect(result.verdict).toBe('REJECTED')
  })
})

describe('scoreDiscoveryCandidate — weighted scoring among survivors', () => {
  it('every strong signal present -> QUALIFIED with a high score', () => {
    const result = scoreDiscoveryCandidate(BASE)
    expect(result.verdict).toBe('QUALIFIED')
    expect(result.score).toBeGreaterThanOrEqual(70)
  })

  it('weak-but-not-disqualifying signals (no domain, unknown size, no sector evidence) land in REVIEW, not auto-QUALIFIED', () => {
    const result = scoreDiscoveryCandidate({
      entityType: 'COMPANY',
      isDuplicateOrAlreadyClaimed: false,
      sectorSignalMatch: 'no_evidence',
      sizeVerdict: 'unknown',
      domainConfirmed: false,
      mentionCount: 1,
    })
    expect(result.verdict).toBe('REVIEW')
    expect(result.score).toBeLessThan(70)
    expect(result.score).toBeGreaterThan(0)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('a medium-confidence domain scores lower than a high-confidence one, all else equal', () => {
    const high = scoreDiscoveryCandidate({ ...BASE, domainConfidence: 'high' })
    const medium = scoreDiscoveryCandidate({ ...BASE, domainConfidence: 'medium' })
    expect(high.score).toBeGreaterThan(medium.score)
  })

  it('mention count contributes but is capped, not unbounded', () => {
    const few = scoreDiscoveryCandidate({ ...BASE, mentionCount: 1 })
    const many = scoreDiscoveryCandidate({ ...BASE, mentionCount: 50 })
    expect(many.score).toBeGreaterThanOrEqual(few.score)
    expect(many.score).toBeLessThanOrEqual(100)
  })

  it('score is never negative and never exceeds 100', () => {
    const worst = scoreDiscoveryCandidate({
      entityType: 'UNKNOWN', isDuplicateOrAlreadyClaimed: false, sectorSignalMatch: 'no_evidence',
      sizeVerdict: 'unknown', domainConfirmed: false, mentionCount: 0,
    })
    expect(worst.score).toBeGreaterThanOrEqual(0)
    expect(worst.score).toBeLessThanOrEqual(100)
  })
})
