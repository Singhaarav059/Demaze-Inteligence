// ============================================================
// Competitor Discovery Engine — filtering/extraction/tiering
// ============================================================
// Covers the pure, network-free pieces of discoverCompetitors() (see
// lib/enrichment/competitor-discovery.ts): name extraction, self-name /
// disqualifier rejection, and confidence tiering. The search calls
// themselves (searchTavily/searchSerper via searchWithFallback) are not
// unit-tested here — same reasoning as enrichment-pdf.test.ts skipping
// fetchPdfText: real HTTP belongs in a live verification run, not a unit
// test, and this repo has no test-quota-spending convention.

import { describe, it, expect } from 'vitest'
import {
  isSelfName,
  classifyRejection,
  extractVsPair,
  extractListAfterTrigger,
  tierConfidence,
  fallbackWhyTheyCompete,
  type CompetitorCandidate,
} from '../lib/enrichment/competitor-discovery'

describe('isSelfName — word-boundary self-match', () => {
  it('matches an exact name', () => {
    expect(isSelfName('Ador Welding', 'Ador Welding')).toBe(true)
  })

  it('matches despite legal-suffix / casing differences', () => {
    expect(isSelfName('Ador Welding Ltd.', 'ador welding')).toBe(true)
  })

  it('does NOT match a different company sharing one generic word', () => {
    expect(isSelfName('Ace Hardware', 'Ace Pipeline')).toBe(false)
  })

  it('does NOT match an unrelated single-word name against a multi-word one', () => {
    expect(isSelfName('Bharat Forge', 'Ador Welding')).toBe(false)
  })

  it('matches a multi-word name against its space-collapsed domain-guess form (found live against Ace Pipeline)', () => {
    expect(isSelfName('Ace Pipeline', 'Acepipeline')).toBe(true)
  })
})

describe('classifyRejection — filtering rules', () => {
  const company = 'Ador Welding'

  it('rejects the self-name', () => {
    expect(classifyRejection('Ador Welding', company, [])).toMatch(/self-name/)
  })

  it('rejects known directory/aggregator/news/certifying-body names', () => {
    expect(classifyRejection('G2', company, [])).toMatch(/directory\/aggregator/)
    expect(classifyRejection('LinkedIn', company, [])).toMatch(/directory\/aggregator/)
    expect(classifyRejection('Reuters', company, [])).toMatch(/directory\/aggregator/)
  })

  it('rejects a candidate framed as a customer, not a competitor', () => {
    expect(classifyRejection('Bharat Forge', company, [
      'Our customers include Bharat Forge and other leading manufacturers.',
    ])).toMatch(/customer/)
  })

  it('rejects a candidate framed as a supplier', () => {
    expect(classifyRejection('Steel Traders Inc', company, [
      'Steel Traders Inc is a supplier to major welding equipment makers.',
    ])).toMatch(/supplier/)
  })

  it('rejects a candidate framed as a certifying body', () => {
    expect(classifyRejection('Bureau Veritas', company, [
      'The plant is certified by Bureau Veritas for quality standards.',
    ])).toMatch(/certifying body/)
  })

  it('rejects a candidate framed as an industry association', () => {
    expect(classifyRejection('Indian Welding Society', company, [
      'Ador Welding is a member of the Indian Welding Society industry association.',
    ])).toMatch(/industry association/)
  })

  it('rejects too-short/generic names', () => {
    expect(classifyRejection('Co', company, [])).toMatch(/too short/)
  })

  it('accepts a real competitor with genuine "vs" framing and no disqualifier', () => {
    expect(classifyRejection('Bharat Forge', company, [
      'Ador Welding vs Bharat Forge: a comparison of welding equipment makers.',
    ])).toBeNull()
  })

  it('rejects the trigger word itself as a candidate name (found live against Bharat Forge)', () => {
    expect(classifyRejection('Alternatives', company, [])).toMatch(/generic\/stopword/)
    expect(classifyRejection('Competitors', company, [])).toMatch(/generic\/stopword/)
  })
})

describe('extractVsPair — "X vs Y" title extraction', () => {
  it('extracts both sides of a clean "vs" title', () => {
    expect(extractVsPair('Ador Welding vs Bharat Forge: Which Is Better?')).toEqual(['Ador Welding', 'Bharat Forge'])
  })

  it('handles "Vs." with a period', () => {
    expect(extractVsPair('Company A Vs. Company B')).toEqual(['Company A', 'Company B'])
  })

  it('returns [] when there is no "vs" pattern', () => {
    expect(extractVsPair('Ador Welding Annual Report 2026')).toEqual([])
  })

  it('returns [] when a side is not capitalized (not name-shaped)', () => {
    expect(extractVsPair('we compete vs everyone in this market')).toEqual([])
  })
})

describe('extractListAfterTrigger — competitor-list extraction', () => {
  it('extracts a comma-separated list after "competitors include"', () => {
    expect(extractListAfterTrigger('Its main competitors include Bharat Forge, Mahindra Forgings, and Ramkrishna Forgings.'))
      .toEqual(expect.arrayContaining(['Bharat Forge', 'Mahindra Forgings', 'Ramkrishna Forgings']))
  })

  it('extracts a list after "alternatives to X include"', () => {
    const names = extractListAfterTrigger('Popular alternatives to Ador Welding include Lincoln Electric and ESAB.')
    expect(names).toEqual(expect.arrayContaining(['Lincoln Electric', 'ESAB']))
  })

  it('extracts after "rivals are"', () => {
    const names = extractListAfterTrigger('Its rivals are Panasonic and Fronius in the robotic welding space.')
    expect(names).toEqual(expect.arrayContaining(['Panasonic', 'Fronius']))
  })

  it('returns [] when there is no trigger phrase at all', () => {
    expect(extractListAfterTrigger('Ador Welding manufactures welding consumables in India.')).toEqual([])
  })

  it('stops at sentence-ending punctuation, not bleeding into the next sentence', () => {
    const names = extractListAfterTrigger('Competitors include Alpha Corp. This next sentence should not be scanned Beta Corp Gamma Corp.')
    expect(names).not.toEqual(expect.arrayContaining(['Beta Corp', 'Gamma Corp']))
  })
})

describe('tierConfidence — confidence tiering', () => {
  const base: Omit<CompetitorCandidate, 'mention_count' | 'explicit_vs_framing'> = {
    name: 'Bharat Forge',
    source_urls: ['https://example.com/a'],
    snippets: ['snippet'],
  }

  it('tiers high: multiple mentions + explicit "vs" framing', () => {
    expect(tierConfidence({ ...base, mention_count: 2, explicit_vs_framing: true })).toBe('high')
  })

  it('tiers medium: multiple mentions but only list-framing', () => {
    expect(tierConfidence({ ...base, mention_count: 3, explicit_vs_framing: false })).toBe('medium')
  })

  it('tiers medium: single mention but explicit "vs" framing', () => {
    expect(tierConfidence({ ...base, mention_count: 1, explicit_vs_framing: true })).toBe('medium')
  })

  it('tiers low: single mention, list-framing only', () => {
    expect(tierConfidence({ ...base, mention_count: 1, explicit_vs_framing: false })).toBe('low')
  })
})

describe('fallbackWhyTheyCompete — code-derived narration fallback', () => {
  it('quotes the first snippet when available', () => {
    const text = fallbackWhyTheyCompete({
      name: 'Bharat Forge', mention_count: 2, source_urls: [], explicit_vs_framing: true,
      snippets: ['Ador Welding vs Bharat Forge: a detailed comparison.'],
    })
    expect(text).toContain('Ador Welding vs Bharat Forge')
    expect(text).toMatch(/named directly/)
  })

  it('falls back to a generic sentence with no snippet', () => {
    const text = fallbackWhyTheyCompete({
      name: 'Bharat Forge', mention_count: 1, source_urls: [], explicit_vs_framing: false, snippets: [],
    })
    expect(text).toMatch(/no snippet captured/)
    expect(text).toMatch(/listed among competitors/)
  })
})
