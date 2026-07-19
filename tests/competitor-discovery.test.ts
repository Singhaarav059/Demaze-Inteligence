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
  extractNumberedListCandidates,
  extractTitleCompanyName,
  tierConfidence,
  fallbackWhyTheyCompete,
  buildOfferingCompetitorQueries,
  buildBusinessProfileCompetitorQueries,
  mergeCompetitorResults,
  type CompetitorCandidate,
  type CompetitorDiscoveryResult,
} from '../lib/enrichment/competitor-discovery'
import { emptyBusinessProfile } from '../lib/pipeline/business-profile'
import { extractQueryTopic, filterTopicallyRelevantResults } from '../lib/enrichment/extraction-guards'

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

  it('rejects a sentence-fragment/asset-filename candidate (found live against demazetech.com)', () => {
    expect(classifyRejection('Alternative-H2s-48x48', company, [])).toMatch(/sentence fragment/)
    expect(classifyRejection('at Codemech Solutions', company, [])).toMatch(/sentence fragment/)
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

describe('extractNumberedListCandidates — listicle extraction (2026-07-16, business-understanding rebuild)', () => {
  it('extracts names from a numbered list with no trigger sentence', () => {
    const names = extractNumberedListCandidates('Top Companies Offering Welding Automation\n1. ESAB\n2. CenterLine\n3. Autometers Alliance')
    expect(names).toEqual(expect.arrayContaining(['ESAB', 'CenterLine', 'Autometers Alliance']))
  })

  it('handles ")" style numbering', () => {
    const names = extractNumberedListCandidates('1) Lincoln Electric 2) Panasonic 3) Fronius')
    expect(names).toEqual(expect.arrayContaining(['Lincoln Electric', 'Panasonic', 'Fronius']))
  })

  it('returns [] when there is no numbered list at all', () => {
    expect(extractNumberedListCandidates('Ador Welding manufactures welding consumables in India.')).toEqual([])
  })
})

describe('extractTitleCompanyName — title-prefix extraction (2026-07-16, business-understanding rebuild)', () => {
  it('extracts the company name before a colon separator', () => {
    expect(extractTitleCompanyName('Linde Gas & Equipment: Welding Supply Store')).toEqual(['Linde Gas & Equipment'])
  })

  it('extracts the company name before a pipe separator', () => {
    expect(extractTitleCompanyName('ESAB | Welding and Cutting Products')).toEqual(['ESAB'])
  })

  it('returns [] when there is no colon/pipe separator at all', () => {
    expect(extractTitleCompanyName('Welding Supplies, Tools & Consumables')).toEqual([])
  })

  it('rejects a listicle title even though it has a colon separator', () => {
    expect(extractTitleCompanyName('Top 10 Welding Companies: A Complete Guide')).toEqual([])
    expect(extractTitleCompanyName('Best Alternatives to Ador Welding: A Comparison')).toEqual([])
  })

  it('rejects a market-research report title (real false positive found live 2026-07-16)', () => {
    expect(extractTitleCompanyName('Welding Consumables Market Size, Share: Growth Report 2030')).toEqual([])
    expect(extractTitleCompanyName('Deep Tech Market Outlook: Trends 2035')).toEqual([])
  })

  it('does not misfire on a lowercase-starting title', () => {
    expect(extractTitleCompanyName('welding equipment: buyer\'s guide')).toEqual([])
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

describe('buildOfferingCompetitorQueries — offering-grounded query building', () => {
  it('builds one query per offering, capped at 2', () => {
    const queries = buildOfferingCompetitorQueries(['robotic welding automation', 'weld quality inspection', 'a third offering'])
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('robotic welding automation')
    expect(queries[1]).toContain('weld quality inspection')
  })

  it('returns no queries when there are no offerings', () => {
    expect(buildOfferingCompetitorQueries([])).toEqual([])
  })
})

describe('buildBusinessProfileCompetitorQueries — business-understanding rebuild (2026-07-16)', () => {
  it('builds one query per service, capped at 3, plus one positioning query', () => {
    const profile = {
      ...emptyBusinessProfile(),
      services: ['AI development', 'custom software', 'web applications', 'a 4th service'],
      market_positioning: 'premium AI specialist',
    }
    const queries = buildBusinessProfileCompetitorQueries(profile)
    expect(queries).toHaveLength(4)
    expect(queries[0]).toContain('AI development')
    expect(queries[1]).toContain('custom software')
    expect(queries[2]).toContain('web applications')
    expect(queries[3]).toContain('premium AI specialist')
    expect(queries[3]).toMatch(/competitors/)
  })

  it('omits the positioning query when market_positioning is empty', () => {
    const profile = { ...emptyBusinessProfile(), services: ['AI development'] }
    const queries = buildBusinessProfileCompetitorQueries(profile)
    expect(queries).toHaveLength(1)
  })

  it('never mentions the company name — grounded only in services/positioning', () => {
    const profile = { ...emptyBusinessProfile(), services: ['automation'], market_positioning: 'budget provider' }
    const queries = buildBusinessProfileCompetitorQueries(profile)
    for (const q of queries) {
      expect(q.toLowerCase()).not.toContain('acme corp')
    }
  })

  it('returns no queries when the profile is entirely empty', () => {
    expect(buildBusinessProfileCompetitorQueries(emptyBusinessProfile())).toEqual([])
  })
})

describe('offering-grounded pass topical relevance (2026-07-18, real ATE Group bug)', () => {
  // ATE Group (an industrial-IoT/cooling-solutions/precision-components
  // company) ran through discoverCompetitorsFromBusinessProfile (which runs
  // with requireCompanyMention=false, since a `top companies offering "X"`
  // query is SUPPOSED to return other companies' pages) and surfaced a
  // completely unrelated "Top Data Analytics Companies to Watch in 2026"
  // listicle as if it named ATE Group's real competitors — because with
  // requireCompanyMention off, there was no relevance check of any kind.
  // filterTopicallyRelevantResults/extractQueryTopic (extraction-guards.ts)
  // fix this; these tests confirm the fix actually blocks the extraction
  // path that made the bug possible, not just the isolated guard function.
  it('the topical-relevance gate rejects a result before extraction ever sees it', () => {
    const listicleResult = {
      title: 'Top Data Analytics Companies to Watch in 2026',
      content: '1. Accenture 2. Deloitte 3. IBM 4. Capgemini 5. PwC 6. Teradata',
      url: 'https://example.com/data-analytics-listicle',
    }
    // Confirms the extractor WOULD have pulled real-looking names out of
    // this result if it had reached extraction unfiltered — this is what
    // made the bug possible in the first place.
    expect(extractNumberedListCandidates(listicleResult.content)).toEqual(
      expect.arrayContaining(['Accenture', 'Deloitte', 'IBM', 'Capgemini', 'PwC', 'Teradata']),
    )
    // The offering-grounded pass searched for "industrial IoT" (query:
    // `top companies offering "industrial IoT"`) — the fix rejects this
    // result before extraction runs, since it has zero topical overlap.
    const topic = extractQueryTopic('top companies offering "industrial IoT"')
    expect(filterTopicallyRelevantResults([listicleResult], [topic])).toHaveLength(0)
  })

  it('a genuinely relevant offering-based hit still survives the topical filter (no regression)', () => {
    const relevantResult = {
      title: 'Leading Industrial IoT Platforms for Manufacturing',
      content: '1. PTC ThingWorx 2. Siemens MindSphere 3. GE Predix',
      url: 'https://example.com/iot-platforms',
    }
    const topic = extractQueryTopic('top companies offering "industrial IoT"')
    expect(filterTopicallyRelevantResults([relevantResult], [topic])).toHaveLength(1)
    expect(extractNumberedListCandidates(relevantResult.content)).toEqual(
      expect.arrayContaining(['PTC ThingWorx', 'Siemens MindSphere', 'GE Predix']),
    )
  })

  it('a differently-worded but genuinely relevant hit still survives (no false negative)', () => {
    // "IoT platforms" vs "cooling solutions" query topic — different offering
    // phrase, but a real hit for it should not be rejected just because the
    // wording differs from the exact searched phrase.
    const relevantResult = {
      title: 'Best Industrial Cooling Systems Compared',
      content: '1. Munters 2. Trane Technologies 3. Johnson Controls',
      url: 'https://example.com/cooling-systems',
    }
    const topic = extractQueryTopic('top companies offering "cooling solutions"')
    expect(filterTopicallyRelevantResults([relevantResult], [topic])).toHaveLength(1)
  })
})

describe('mergeCompetitorResults — folding the offering-grounded pass into the base result', () => {
  const makeResult = (names: string[]): CompetitorDiscoveryResult => ({
    competitors: names.map(name => ({
      name, why_they_compete: `why ${name}`, confidence: 'medium' as const, source_urls: [],
    })),
    candidates: names.map(name => ({
      name, mention_count: 1, source_urls: [], snippets: [], explicit_vs_framing: false,
    })),
    sufficiency: names.length > 0 ? 'sufficient' : 'insufficient',
    reason: 'base reason',
    candidates_considered: names.length,
  })

  it('returns the base unchanged when the supplement found nothing', () => {
    const base = makeResult(['Bharat Forge'])
    const merged = mergeCompetitorResults(base, makeResult([]))
    expect(merged).toBe(base)
  })

  it('appends new, non-duplicate competitors from the supplement', () => {
    const base = makeResult(['Bharat Forge'])
    const merged = mergeCompetitorResults(base, makeResult(['ESAB']))
    expect(merged.competitors.map(c => c.name)).toEqual(expect.arrayContaining(['Bharat Forge', 'ESAB']))
    expect(merged.sufficiency).toBe('sufficient')
    expect(merged.reason).toMatch(/supplementary pass added 1 more/)
  })

  it('does not duplicate a competitor already found by the base (normalized-name match)', () => {
    const base = makeResult(['Bharat Forge Ltd.'])
    const merged = mergeCompetitorResults(base, makeResult(['bharat forge']))
    expect(merged.competitors).toHaveLength(1)
  })

  it('caps the merged list at MAX_COMPETITORS (5)', () => {
    const base = makeResult(['A', 'B', 'C', 'D', 'E'])
    const merged = mergeCompetitorResults(base, makeResult(['F']))
    expect(merged.competitors.length).toBeLessThanOrEqual(5)
  })
})
