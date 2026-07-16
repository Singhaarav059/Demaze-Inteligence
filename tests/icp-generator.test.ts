// ============================================================
// ICP Generator — filtering/extraction/tiering
// ============================================================
// Covers the pure, network-free pieces of discoverICPSegments() (see
// lib/enrichment/icp-generator.ts): segment extraction, self-name/generic-
// term rejection, and confidence tiering. The search calls themselves
// (searchTavily/searchSerper via searchWithFallback) are not unit-tested
// here — same reasoning as tests/competitor-discovery.test.ts.

import { describe, it, expect } from 'vitest'
import {
  classifySegmentRejection,
  extractSegmentsAfterTrigger,
  tierConfidence,
  fallbackReason,
  buildOfferingICPQueries,
  buildBusinessProfileICPQueries,
  mergeICPResults,
  type ICPCandidate,
  type ICPDiscoveryResult,
} from '../lib/enrichment/icp-generator'
import { emptyBusinessProfile } from '../lib/pipeline/business-profile'

describe('classifySegmentRejection — filtering rules', () => {
  const company = 'Ador Welding'

  it('rejects the self-name', () => {
    expect(classifySegmentRejection('Ador Welding', company)).toMatch(/self-name/)
  })

  it('rejects generic single-word terms', () => {
    expect(classifySegmentRejection('customers', company)).toMatch(/generic/)
    expect(classifySegmentRejection('businesses', company)).toMatch(/generic/)
    expect(classifySegmentRejection('industries', company)).toMatch(/generic/)
  })

  it('rejects too-short/generic names', () => {
    expect(classifySegmentRejection('Co', company)).toMatch(/too short/)
  })

  it('accepts a real segment name', () => {
    expect(classifySegmentRejection('automotive manufacturers', company)).toBeNull()
  })

  it('accepts a proper-noun-shaped industry segment', () => {
    expect(classifySegmentRejection('Food and Beverage', company)).toBeNull()
  })

  it('rejects sentence-fragment candidates (found live against demazetech.com)', () => {
    expect(classifySegmentRejection('at Codemech Solutions', company)).toMatch(/sentence fragment/)
    expect(classifySegmentRejection("some of the world's biggest businesses", company)).toMatch(/sentence fragment/)
    expect(classifySegmentRejection('some of the', company)).toMatch(/sentence fragment/)
    expect(classifySegmentRejection('as a powerful backend system for the sales team', company)).toMatch(/sentence fragment/)
  })

  it('rejects vague possessive-pronoun phrases (found live against demazetech.com, "our clients")', () => {
    expect(classifySegmentRejection('our clients', company)).toMatch(/generic/)
    expect(classifySegmentRejection('their customers', company)).toMatch(/generic/)
    expect(classifySegmentRejection('its partners', company)).toMatch(/generic/)
  })
})

describe('extractSegmentsAfterTrigger — segment-list extraction', () => {
  it('extracts a comma-separated list after "industries we serve include"', () => {
    const names = extractSegmentsAfterTrigger('Industries we serve include automotive, aerospace, and pharmaceuticals.')
    expect(names).toEqual(expect.arrayContaining(['automotive', 'aerospace', 'pharmaceuticals']))
  })

  it('extracts a list after "clients include"', () => {
    const names = extractSegmentsAfterTrigger('Our clients include mid-size manufacturers and automotive OEMs.')
    expect(names).toEqual(expect.arrayContaining(['mid-size manufacturers', 'automotive OEMs']))
  })

  it('extracts a list after "customers include"', () => {
    const names = extractSegmentsAfterTrigger('Customers include hospitals, clinics, and diagnostic labs.')
    expect(names).toEqual(expect.arrayContaining(['hospitals', 'clinics', 'diagnostic labs']))
  })

  it('extracts after "serving the X industry"', () => {
    const names = extractSegmentsAfterTrigger('The company has decades of experience serving the automotive industry.')
    expect(names).toEqual(expect.arrayContaining(['automotive industry']))
  })

  it('returns [] when there is no trigger phrase at all', () => {
    expect(extractSegmentsAfterTrigger('Ador Welding manufactures welding consumables in India.')).toEqual([])
  })

  it('stops at sentence-ending punctuation, not bleeding into the next sentence', () => {
    const names = extractSegmentsAfterTrigger('Clients include automotive OEMs. This next sentence should not be scanned aerospace firms.')
    expect(names).not.toEqual(expect.arrayContaining(['aerospace firms']))
  })

  it('keeps "oil and gas" as one segment, not split on "and" (live bug, 2026-07-15)', () => {
    const names = extractSegmentsAfterTrigger('Industries we serve include shipbuilding, oil and gas, infrastructure, and power.')
    expect(names).toEqual(expect.arrayContaining(['shipbuilding', 'oil and gas', 'infrastructure', 'power']))
    expect(names).not.toEqual(expect.arrayContaining(['oil']))
    expect(names).not.toEqual(expect.arrayContaining(['gas']))
  })

  it('keeps other known compound idioms intact (food and beverage, textile and apparel)', () => {
    const names = extractSegmentsAfterTrigger('Clients include food and beverage manufacturers and textile and apparel producers.')
    expect(names).toEqual(expect.arrayContaining(['food and beverage manufacturers', 'textile and apparel producers']))
  })

  it('extracts a heading-style period-delimited list, not an empty window (real demazetech.com content, found live 2026-07-16)', () => {
    const names = extractSegmentsAfterTrigger(
      'Industries We Serve. Healthcare. Telemedicine Platforms. Electronic Health Records (EHR). Patient ... Demaze Technologies © 2025. All rights reserved.'
    )
    expect(names).toEqual(expect.arrayContaining(['Healthcare', 'Telemedicine Platforms', 'Electronic Health Records (EHR)']))
    expect(names).not.toEqual(expect.arrayContaining(['Demaze Technologies © 2025']))
    expect(names).not.toEqual(expect.arrayContaining(['All rights reserved']))
  })

  it('stops the heading-style list at the first boilerplate/copyright item', () => {
    const names = extractSegmentsAfterTrigger('Industries We Serve. Automotive. Aerospace. Acme Corp © 2026. All rights reserved.')
    expect(names).toEqual(['Automotive', 'Aerospace'])
  })

  it('stops the heading-style list once a long, sentence-shaped item appears', () => {
    const names = extractSegmentsAfterTrigger(
      'Industries We Serve. Automotive. We have been proudly serving this sector for over twenty five years now.'
    )
    expect(names).toEqual(['Automotive'])
  })
})

describe('tierConfidence — confidence tiering', () => {
  const base: Omit<ICPCandidate, 'mention_count' | 'explicit_serve_framing'> = {
    name: 'automotive manufacturers',
    source_urls: ['https://example.com/a'],
    snippets: ['snippet'],
  }

  it('tiers high: multiple mentions + explicit serve framing', () => {
    expect(tierConfidence({ ...base, mention_count: 2, explicit_serve_framing: true })).toBe('high')
  })

  it('tiers medium: multiple mentions but no explicit framing', () => {
    expect(tierConfidence({ ...base, mention_count: 3, explicit_serve_framing: false })).toBe('medium')
  })

  it('tiers medium: single mention but explicit framing', () => {
    expect(tierConfidence({ ...base, mention_count: 1, explicit_serve_framing: true })).toBe('medium')
  })

  it('tiers low: single mention, no explicit framing', () => {
    expect(tierConfidence({ ...base, mention_count: 1, explicit_serve_framing: false })).toBe('low')
  })
})

describe('fallbackReason — code-derived narration fallback', () => {
  it('quotes the first snippet when available', () => {
    const text = fallbackReason({
      name: 'automotive manufacturers', mention_count: 2, source_urls: [], explicit_serve_framing: true,
      snippets: ['Industries we serve include automotive manufacturers and aerospace firms.'],
    })
    expect(text).toContain('Industries we serve include automotive manufacturers')
    expect(text).toMatch(/named directly/)
  })

  it('falls back to a generic sentence with no snippet', () => {
    const text = fallbackReason({
      name: 'automotive manufacturers', mention_count: 1, source_urls: [], explicit_serve_framing: false, snippets: [],
    })
    expect(text).toMatch(/no snippet captured/)
    expect(text).toMatch(/mentioned alongside/)
  })
})

describe('buildOfferingICPQueries — offering-grounded query building', () => {
  it('builds one query per offering, capped at 2', () => {
    const queries = buildOfferingICPQueries(['robotic welding automation', 'weld quality inspection', 'a third offering'])
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('robotic welding automation')
    expect(queries[1]).toContain('weld quality inspection')
  })

  it('returns no queries when there are no offerings', () => {
    expect(buildOfferingICPQueries([])).toEqual([])
  })
})

describe('buildBusinessProfileICPQueries — business-understanding rebuild (2026-07-16)', () => {
  it('builds "who needs X" queries drawn from services + problems_solved + business_outcomes, capped at 3', () => {
    const profile = {
      ...emptyBusinessProfile(),
      services: ['AI development'],
      problems_solved: ['manual reporting'],
      business_outcomes: ['faster turnaround'],
    }
    const queries = buildBusinessProfileICPQueries(profile)
    expect(queries).toHaveLength(3)
    expect(queries[0]).toMatch(/who needs/)
    expect(queries[0]).toContain('AI development')
    expect(queries[1]).toContain('manual reporting')
    expect(queries[2]).toContain('faster turnaround')
  })

  it('caps at 3 even when all three source fields together exceed it', () => {
    const profile = {
      ...emptyBusinessProfile(),
      services: ['a', 'b'],
      problems_solved: ['c', 'd'],
      business_outcomes: ['e'],
    }
    expect(buildBusinessProfileICPQueries(profile)).toHaveLength(3)
  })

  it('returns no queries when the profile is entirely empty', () => {
    expect(buildBusinessProfileICPQueries(emptyBusinessProfile())).toEqual([])
  })
})

describe('mergeICPResults — folding the offering-grounded pass into the base result', () => {
  const makeResult = (names: string[]): ICPDiscoveryResult => ({
    segments: names.map(name => ({
      name, reason: `reason ${name}`, signals: [], confidence: 'medium' as const, source_urls: [],
    })),
    candidates: names.map(name => ({
      name, mention_count: 1, source_urls: [], snippets: [], explicit_serve_framing: false,
    })),
    sufficiency: names.length > 0 ? 'sufficient' : 'insufficient',
    reason: 'base reason',
    candidates_considered: names.length,
  })

  it('returns the base unchanged when the supplement found nothing', () => {
    const base = makeResult(['oil and gas'])
    const merged = mergeICPResults(base, makeResult([]))
    expect(merged).toBe(base)
  })

  it('appends new, non-duplicate segments from the supplement', () => {
    const base = makeResult(['oil and gas'])
    const merged = mergeICPResults(base, makeResult(['shipbuilding']))
    expect(merged.segments.map(s => s.name)).toEqual(expect.arrayContaining(['oil and gas', 'shipbuilding']))
    expect(merged.sufficiency).toBe('sufficient')
    expect(merged.reason).toMatch(/supplementary pass added 1 more/)
  })

  it('does not duplicate a segment already found by the base (normalized-name match)', () => {
    const base = makeResult(['Oil and Gas'])
    const merged = mergeICPResults(base, makeResult(['oil and gas']))
    expect(merged.segments).toHaveLength(1)
  })
})
