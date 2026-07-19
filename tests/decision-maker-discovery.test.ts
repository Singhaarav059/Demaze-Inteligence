// ============================================================
// Decision-Maker Discovery — mock provider tests
// ============================================================
// Confirms the deterministic-mock discipline: same (companyName, domain,
// targetTitles) always produces the same result, never throws, defaults to
// DEFAULT_TARGET_TITLES when omitted, and degrades gracefully on missing
// input — same shape as tests/email-finder.test.ts.
// ============================================================

import { describe, it, expect } from 'vitest'
import { MockDecisionMakerDiscoveryProvider } from '../lib/outbound/decision-maker-discovery/providers/mock'
import { DEFAULT_TARGET_TITLES } from '../lib/outbound/decision-maker-discovery/types'
import { groundCandidate, groundCandidates } from '../lib/outbound/decision-maker-discovery/grounding'
import { discoverDecisionMakers } from '../lib/outbound/decision-maker-discovery/provider-factory'
import type { DecisionMakerCandidate } from '../lib/outbound/decision-maker-discovery/types'

describe('MockDecisionMakerDiscoveryProvider', () => {
  it('is deterministic — same input always produces the same result', async () => {
    const request = { companyName: 'Acme Corp', domain: 'acme.com', targetTitles: ['CEO', 'CTO'] }
    const a = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers(request)
    const b = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers(request)
    expect(a).toEqual(b)
  })

  it('uses DEFAULT_TARGET_TITLES when targetTitles is omitted', async () => {
    const withDefault = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme Corp',
      domain: 'acme.com',
    })
    const withExplicitDefault = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme Corp',
      domain: 'acme.com',
      targetTitles: DEFAULT_TARGET_TITLES,
    })
    expect(withDefault).toEqual(withExplicitDefault)
  })

  it('uses DEFAULT_TARGET_TITLES when targetTitles is an empty array', async () => {
    const withEmpty = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme Corp',
      domain: 'acme.com',
      targetTitles: [],
    })
    const withDefault = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme Corp',
      domain: 'acme.com',
    })
    expect(withEmpty).toEqual(withDefault)
  })

  it('produces at least some found candidates with valid shape across a spread of companies', async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        MockDecisionMakerDiscoveryProvider.discoverDecisionMakers({
          companyName: `Test Company ${i}`,
          domain: `testcompany${i}.com`,
        })
      )
    )
    const withCandidates = results.filter(r => r.candidates.length > 0)
    expect(withCandidates.length).toBeGreaterThan(0)

    for (const result of withCandidates) {
      expect(result.status).toBe('found')
      expect(result.providerUsed).toBe('mock')
      for (const candidate of result.candidates) {
        expect(candidate.personName).toMatch(/^\S+ \S+$/)
        expect(DEFAULT_TARGET_TITLES.includes(candidate.title) || typeof candidate.title === 'string').toBe(true)
        expect(['high', 'medium', 'low']).toContain(candidate.confidence)
      }
    }
  })

  it('only returns candidates for requested titles', async () => {
    const result = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme Corp',
      domain: 'acme.com',
      targetTitles: ['CEO', 'CTO', 'VP Operations'],
    })
    for (const candidate of result.candidates) {
      expect(['CEO', 'CTO', 'VP Operations']).toContain(candidate.title)
    }
  })

  it('never throws and returns status="error" with missing companyName', async () => {
    const result = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: '',
      domain: 'acme.com',
    })
    expect(result.status).toBe('error')
    expect(result.candidates).toEqual([])
  })

  it('never throws and returns status="error" with missing domain', async () => {
    const result = await MockDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme Corp',
      domain: '',
    })
    expect(result.status).toBe('error')
    expect(result.candidates).toEqual([])
  })

  it('isAvailable always resolves true', async () => {
    expect(await MockDecisionMakerDiscoveryProvider.isAvailable()).toBe(true)
  })
})

// ============================================================
// Website Grounding (2026-07-18 fix) — cross-checks a provider-returned
// candidate against the company's own already-extracted leadership content
// (lib/pipeline/evidence-extractor.ts's leadershipContacts, threaded through
// at the API route boundary). Simple match/no-match/conflict flag, same
// "flag for manual review, never silently auto-merge" discipline as
// possibleDuplicateOf in lib/batch/company-dedup.ts.
// ============================================================
describe('groundCandidate / groundCandidates', () => {
  const baseCandidate: DecisionMakerCandidate = {
    personName: 'Jane Doe',
    title: 'CEO',
    confidence: 'medium',
  }

  it('returns the candidate unchanged when no leadershipContacts are given', () => {
    expect(groundCandidate(baseCandidate, undefined)).toEqual(baseCandidate)
    expect(groundCandidate(baseCandidate, [])).toEqual(baseCandidate)
  })

  it('marks a candidate "confirmed" when name matches and titles are the same acronym/spelled-out role', () => {
    const grounded = groundCandidate(baseCandidate, [{ name: 'Jane Doe', title: 'Chief Executive Officer' }])
    expect(grounded.grounding?.status).toBe('confirmed')
    expect(grounded.grounding?.reason).toContain('Chief Executive Officer')
  })

  it('marks a candidate "confirmed" when titles overlap substantially in wording', () => {
    const grounded = groundCandidate(
      { ...baseCandidate, title: 'VP Operations' },
      [{ name: 'Jane Doe', title: 'Vice President of Operations' }]
    )
    expect(grounded.grounding?.status).toBe('confirmed')
  })

  it('marks a candidate "conflict" when the name matches but the on-site title is unrelated', () => {
    const grounded = groundCandidate(
      { ...baseCandidate, title: 'VP Sales' },
      [{ name: 'Jane Doe', title: 'Chief Financial Officer' }]
    )
    expect(grounded.grounding?.status).toBe('conflict')
    expect(grounded.grounding?.reason).toContain('Chief Financial Officer')
  })

  it('marks a candidate "not_found" when the name has no match at all', () => {
    const grounded = groundCandidate(baseCandidate, [{ name: 'John Smith', title: 'CEO' }])
    expect(grounded.grounding?.status).toBe('not_found')
  })

  it('matches names by word overlap, not naive substring — different people are not confused', () => {
    // "Jan" should never match "Janardhan" via substring — this exercises
    // the same word-boundary discipline as isSelfName()/matchesKeyword().
    const grounded = groundCandidate(
      { personName: 'Jan Patel', title: 'CEO', confidence: 'medium' },
      [{ name: 'Janardhan Patel Sharma', title: 'CEO' }]
    )
    expect(grounded.grounding?.status).toBe('not_found')
  })

  it('groundCandidates maps grounding across every candidate independently', () => {
    const candidates: DecisionMakerCandidate[] = [
      { personName: 'Jane Doe', title: 'CEO', confidence: 'high' },
      { personName: 'Unknown Person', title: 'COO', confidence: 'medium' },
    ]
    const grounded = groundCandidates(candidates, [{ name: 'Jane Doe', title: 'Chief Executive Officer' }])
    expect(grounded[0].grounding?.status).toBe('confirmed')
    expect(grounded[1].grounding?.status).toBe('not_found')
  })
})

describe('discoverDecisionMakers (provider-factory) — grounding integration', () => {
  it('attaches grounding to every found candidate when leadershipContacts is provided', async () => {
    const result = await discoverDecisionMakers({
      companyName: 'Acme Corp',
      domain: 'acme.com',
      targetTitles: ['CEO', 'CTO'],
      leadershipContacts: [{ name: 'Someone Unrelated', title: 'CEO' }],
    })
    expect(result.status).toBe('found')
    for (const candidate of result.candidates) {
      expect(candidate.grounding).toBeDefined()
      expect(['confirmed', 'conflict', 'not_found']).toContain(candidate.grounding?.status)
    }
  })

  it('leaves candidates ungrounded when leadershipContacts is omitted (backward compatible)', async () => {
    const result = await discoverDecisionMakers({
      companyName: 'Acme Corp',
      domain: 'acme.com',
      targetTitles: ['CEO', 'CTO'],
    })
    expect(result.status).toBe('found')
    for (const candidate of result.candidates) {
      expect(candidate.grounding).toBeUndefined()
    }
  })
})
