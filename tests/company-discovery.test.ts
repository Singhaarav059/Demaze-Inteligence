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
  buildLLMExtractionPrompt,
  parseLLMExtractionResponse,
  filterAlreadyResearched,
  normalizeDomain,
  looksLikeUrlOrDomain,
  discoverCompanies,
  type CompanyDiscoveryCandidate,
  type CompanyMatch,
} from '../lib/enrichment/company-discovery'

describe('looksLikeUrlOrDomain — ICP-segment-field misuse guard', () => {
  it('flags a full URL (the live TCS bug)', () => {
    expect(looksLikeUrlOrDomain('https://www.tcs.com/')).toBe(true)
  })

  it('flags a bare domain', () => {
    expect(looksLikeUrlOrDomain('tcs.com')).toBe(true)
    expect(looksLikeUrlOrDomain('www.tcs.com')).toBe(true)
  })

  it('does not flag a real multi-word ICP segment', () => {
    expect(looksLikeUrlOrDomain('oil and gas')).toBe(false)
    expect(looksLikeUrlOrDomain('automotive manufacturers')).toBe(false)
    expect(looksLikeUrlOrDomain('mid-size SaaS companies')).toBe(false)
  })

  it('does not flag a real single-word ICP segment', () => {
    expect(looksLikeUrlOrDomain('manufacturing')).toBe(false)
    expect(looksLikeUrlOrDomain('SaaS')).toBe(false)
  })

  it('does not flag empty input', () => {
    expect(looksLikeUrlOrDomain('')).toBe(false)
    expect(looksLikeUrlOrDomain('   ')).toBe(false)
  })
})

describe('discoverCompanies — rejects URL/domain input before searching', () => {
  it('returns an honest, actionable insufficient result instead of searching', async () => {
    const result = await discoverCompanies('https://www.tcs.com/')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.companies).toEqual([])
    expect(result.reason).toMatch(/looks like a company URL\/domain/)
  })
})

describe('classifyCompanyRejection — filtering rules', () => {
  const exclude = ['Ador Welding']

  it('rejects the excluded/self company name', () => {
    expect(classifyCompanyRejection('Ador Welding', exclude)).toMatch(/self-name/)
  })

  it('rejects a space-collapsed self-name match (domain-guess-shaped)', () => {
    expect(classifyCompanyRejection('Ador Welding', ['Adorwelding'])).toMatch(/self-name/)
  })

  it('rejects a match against any name in a multi-exclude list', () => {
    expect(classifyCompanyRejection('Ador Welding', ['Some Other Co', 'Ador Welding'])).toMatch(/self-name/)
  })

  it('allows anything when no exclude name is given', () => {
    expect(classifyCompanyRejection('Ador Welding', undefined)).toBeNull()
    expect(classifyCompanyRejection('Ador Welding', [])).toBeNull()
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

describe('buildLLMExtractionPrompt', () => {
  it('includes the ICP segment and one indexed block per result', () => {
    const results = [
      { title: 'Top oil and gas companies', content: 'Anadarko and Hess lead the sector.' },
      { title: 'Directory listing', content: 'Filter by India, Number of Employees.' },
    ]
    const { systemPrompt, userPrompt } = buildLLMExtractionPrompt(results, 'oil and gas')
    expect(systemPrompt).toMatch(/never invent/i)
    expect(userPrompt).toContain('oil and gas')
    expect(userPrompt).toContain('[0]')
    expect(userPrompt).toContain('[1]')
    expect(userPrompt).toContain('Anadarko and Hess lead the sector.')
  })
})

describe('parseLLMExtractionResponse', () => {
  it('parses a well-formed JSON array response', () => {
    const raw = '[{"index": 0, "companies": ["Anadarko", "Hess"]}, {"index": 1, "companies": []}]'
    expect(parseLLMExtractionResponse(raw, 2)).toEqual([['Anadarko', 'Hess'], []])
  })

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n[{"index": 0, "companies": ["Zoho"]}]\n```'
    expect(parseLLMExtractionResponse(raw, 1)).toEqual([['Zoho']])
  })

  it('returns all-empty arrays for malformed JSON rather than throwing', () => {
    expect(parseLLMExtractionResponse('not json at all', 2)).toEqual([[], []])
  })

  it('ignores out-of-range indices and non-string company entries', () => {
    const raw = '[{"index": 5, "companies": ["Ghost"]}, {"index": 0, "companies": ["Real Co", 42, "X"]}]'
    // index 5 out of range for expectedCount=2 -> dropped; "X" too short (<2 chars) -> dropped; 42 not a string -> dropped
    expect(parseLLMExtractionResponse(raw, 2)).toEqual([['Real Co'], []])
  })

  it('pads to expectedCount even when the response has fewer entries', () => {
    expect(parseLLMExtractionResponse('[{"index": 0, "companies": ["Acme"]}]', 3)).toEqual([['Acme'], [], []])
  })
})

describe('normalizeDomain', () => {
  it('strips protocol, www, and path', () => {
    expect(normalizeDomain('https://www.Acme.com/about')).toBe('acme.com')
    expect(normalizeDomain('acme.com')).toBe('acme.com')
    expect(normalizeDomain('http://acme.com')).toBe('acme.com')
  })
})

describe('filterAlreadyResearched', () => {
  function match(name: string, domain?: string): CompanyMatch {
    return { name, domain, reason: 'x', confidence: 'medium', source_urls: [] }
  }

  it('filters a candidate whose domain matches a prior run (URL-shaped company_url)', () => {
    const companies = [match('Bharat Forge', 'bharatforge.com'), match('New Co', 'newco.com')]
    const history = [{ companyUrl: 'https://www.bharatforge.com/', domain: null }]
    const { survivors, filteredOut } = filterAlreadyResearched(companies, history)
    expect(survivors.map(c => c.name)).toEqual(['New Co'])
    expect(filteredOut).toHaveLength(1)
    expect(filteredOut[0].name).toBe('Bharat Forge')
  })

  it('filters a candidate whose domain matches a prior run (domain column)', () => {
    const companies = [match('Bharat Forge', 'bharatforge.com')]
    const history = [{ companyUrl: 'Bharat Forge', domain: 'bharatforge.com' }]
    const { survivors } = filterAlreadyResearched(companies, history)
    expect(survivors).toHaveLength(0)
  })

  it('filters a no-domain candidate by normalized name match against a bare-name company_url', () => {
    const companies = [match('Om Enterprises')]
    const history = [{ companyUrl: 'Om Enterprises Ltd', domain: null }]
    const { survivors } = filterAlreadyResearched(companies, history)
    expect(survivors).toHaveLength(0)
  })

  it('does not cross-match a no-domain candidate against an unrelated domain-shaped record', () => {
    const companies = [match('Om Enterprises')]
    const history = [{ companyUrl: 'https://unrelated.com', domain: 'unrelated.com' }]
    const { survivors } = filterAlreadyResearched(companies, history)
    expect(survivors).toHaveLength(1)
  })

  it('survives everything when history is empty', () => {
    const companies = [match('Bharat Forge', 'bharatforge.com'), match('Om Enterprises')]
    const { survivors, filteredOut } = filterAlreadyResearched(companies, [])
    expect(survivors).toHaveLength(2)
    expect(filteredOut).toHaveLength(0)
  })
})
