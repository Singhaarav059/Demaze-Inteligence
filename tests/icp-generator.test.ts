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
  type ICPCandidate,
} from '../lib/enrichment/icp-generator'

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
