// ============================================================
// Company Discovery Engine — filtering/extraction/tiering
// ============================================================
// Covers the pure, network-free pieces of discoverCompanies() (see
// lib/enrichment/company-discovery.ts): candidate-name extraction
// (trigger-phrase list + numbered list), self-name/directory/generic-term
// rejection, and confidence tiering. Domain resolution
// (discoverCompanyWebsite) and the search calls themselves are not
// unit-tested here — same reasoning as tests/competitor-discovery.test.ts
// and tests/icp-generator.test.ts.

import { describe, it, expect } from 'vitest'
import {
  classifyCompanyRejection,
  extractCompaniesAfterTrigger,
  extractNumberedListCompanies,
  tierMatchConfidence,
  fallbackReason,
  type CompanyDiscoveryCandidate,
} from '../lib/enrichment/company-discovery'

describe('classifyCompanyRejection — filtering rules', () => {
  const exclude = 'Ador Welding'

  it('rejects the excluded/self company name', () => {
    expect(classifyCompanyRejection('Ador Welding', exclude)).toMatch(/self-name/)
  })

  it('rejects a space-collapsed self-name match (domain-guess-shaped)', () => {
    expect(classifyCompanyRejection('Ador Welding', 'Adorwelding')).toMatch(/self-name/)
  })

  it('allows anything when no exclude name is given', () => {
    expect(classifyCompanyRejection('Ador Welding', undefined)).toBeNull()
  })

  it('rejects known directory/aggregator/social names', () => {
    expect(classifyCompanyRejection('G2', exclude)).toMatch(/directory/)
    expect(classifyCompanyRejection('Crunchbase', exclude)).toMatch(/directory/)
    expect(classifyCompanyRejection('LinkedIn', exclude)).toMatch(/directory/)
  })

  it('rejects too-short/generic names', () => {
    expect(classifyCompanyRejection('Co', exclude)).toMatch(/too short/)
  })

  it('rejects generic/stopword phrases', () => {
    expect(classifyCompanyRejection('Top Companies', exclude)).toMatch(/generic/)
    expect(classifyCompanyRejection('The Companies', exclude)).toMatch(/generic/)
  })

  it('accepts a real company name', () => {
    expect(classifyCompanyRejection('Bharat Forge', exclude)).toBeNull()
    expect(classifyCompanyRejection('Zoho Corporation', exclude)).toBeNull()
  })
})

describe('extractCompaniesAfterTrigger — trigger-phrase list extraction', () => {
  it('extracts a list after "top companies"', () => {
    const names = extractCompaniesAfterTrigger('The top companies in automotive manufacturing are Bharat Forge, Tata Motors and Mahindra.')
    expect(names).toEqual(expect.arrayContaining(['Bharat Forge', 'Tata Motors', 'Mahindra']))
  })

  it('extracts a list after "companies like"', () => {
    const names = extractCompaniesAfterTrigger('SaaS companies like Zoho, Freshworks, Chargebee dominate this space.')
    expect(names).toEqual(expect.arrayContaining(['Zoho', 'Freshworks', 'Chargebee']))
  })

  it('extracts a list after "leading X companies"', () => {
    const names = extractCompaniesAfterTrigger('Leading companies include Ador Welding and ESAB India.')
    expect(names).toEqual(expect.arrayContaining(['Ador Welding', 'ESAB India']))
  })

  it('returns empty when no trigger phrase is present', () => {
    expect(extractCompaniesAfterTrigger('Random prose about Bharat Forge with no trigger phrase.')).toEqual([])
  })

  it('does not bleed past a sentence boundary', () => {
    const names = extractCompaniesAfterTrigger('Top companies include Zoho. Separately, Freshworks raised funding.')
    expect(names).not.toContain('Separately')
    expect(names).toContain('Zoho')
  })
})

describe('extractNumberedListCompanies — numbered-list extraction', () => {
  it('extracts companies from a numbered list with periods', () => {
    const text = '1. Zoho\n2. Freshworks\n3. Chargebee'
    expect(extractNumberedListCompanies(text)).toEqual(['Zoho', 'Freshworks', 'Chargebee'])
  })

  it('extracts companies from a numbered list with parens', () => {
    const text = '1) Ador Welding 2) ESAB India 3) CenterLine'
    expect(extractNumberedListCompanies(text)).toEqual(['Ador Welding', 'ESAB India', 'CenterLine'])
  })

  it('returns empty for prose with no numbered list', () => {
    expect(extractNumberedListCompanies('Just a plain sentence about companies.')).toEqual([])
  })
})

describe('tierMatchConfidence — confidence tiering', () => {
  function candidate(mention_count: number): CompanyDiscoveryCandidate {
    return { name: 'X', mention_count, source_urls: [], snippets: [] }
  }

  it('tiers high at 2+ mentions', () => {
    expect(tierMatchConfidence(candidate(2))).toBe('high')
    expect(tierMatchConfidence(candidate(5))).toBe('high')
  })

  it('tiers medium at exactly 1 mention', () => {
    expect(tierMatchConfidence(candidate(1))).toBe('medium')
  })

  it('tiers low at 0 mentions', () => {
    expect(tierMatchConfidence(candidate(0))).toBe('low')
  })
})

describe('fallbackReason', () => {
  it('includes the ICP segment and a snippet when available', () => {
    const candidate: CompanyDiscoveryCandidate = {
      name: 'Bharat Forge', mention_count: 2, source_urls: ['https://x.com'],
      snippets: ['Bharat Forge is a leading automotive forging company.'],
    }
    const reason = fallbackReason(candidate, 'automotive manufacturers')
    expect(reason).toContain('automotive manufacturers')
    expect(reason).toContain('Bharat Forge is a leading automotive forging company')
  })

  it('falls back to a no-snippet message when none captured', () => {
    const candidate: CompanyDiscoveryCandidate = { name: 'X', mention_count: 1, source_urls: [], snippets: [] }
    expect(fallbackReason(candidate, 'oil and gas')).toContain('no snippet captured')
  })
})
