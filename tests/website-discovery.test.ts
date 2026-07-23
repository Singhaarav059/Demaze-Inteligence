// ============================================================
// Website Discovery — precision tests
// ============================================================
// Covers both the pure, network-free scoring/guard helpers directly
// (scoreCandidate, isKnownNonCorporateDomain, wordsAppearTogether) and the
// full discoverCompanyWebsite() flow with searchTavily/searchSerper and
// global.fetch mocked — same "mocked global.fetch" precedent as
// tests/prospeo-client.test.ts, applied here to also mock the
// discovery-engine search module (file-scoped vi.mock, hoisted).
//
// This is the regression suite for CLAUDE.md's documented website-discovery
// precision history: the single-word-name guard (AITG/miraheze.org), the
// genuine "Om Enterprises"/"A-1 Fence Products vs A-1 Fence Company"
// ambiguity cases, "Shree Balaji Fabricators"'s partial-title downgrade,
// and this session's two new guards — the known-non-corporate-domain list
// and the word-proximity requirement for body/description-only matches —
// added to fix the live "Anadarko Petroleum" -> petroleum.gov.gy false
// positive (see CLAUDE.md, 2026-07-23).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/enrichment/discovery-engine', () => ({
  searchTavily: vi.fn(),
  searchSerper: vi.fn(),
}))

import { searchTavily } from '../lib/enrichment/discovery-engine'
import {
  discoverCompanyWebsite,
  scoreCandidate,
  isKnownNonCorporateDomain,
  wordsAppearTogether,
  normalizeCompanyName,
  significantWords,
  type HomepageIdentity,
} from '../lib/enrichment/website-discovery'

const mockedSearchTavily = vi.mocked(searchTavily)

function wordsFor(companyName: string): string[] {
  return significantWords(normalizeCompanyName(companyName))
}

function htmlPage(title: string, description: string, body: string): string {
  return `<html><head><title>${title}</title><meta name="description" content="${description}"></head><body>${body}</body></html>`
}

// Builds body text where "anadarko" and "petroleum" both genuinely appear,
// but separated by a buffer well beyond the 120-char proximity window on
// both sides — simulates the real live false-positive shape (a generic
// government/industry portal that mentions a company's distinctive word
// once, far from any mention of the industry's generic word) without
// relying on exact real sentence lengths.
function farApartMentionsBody(): string {
  const buffer = 'unrelated filler text about regional economic policy '.repeat(6) // ~300 chars
  return (
    'Government petroleum sector overview remains active. ' +
    buffer +
    'In separate news, Anadarko previously held stakes abroad. ' +
    buffer +
    'Petroleum revenue reporting continues elsewhere. '
  )
}

// domain -> { title, description, body } for the mocked fetch below
let pages: Record<string, { title: string; description: string; body: string }>

beforeEach(() => {
  pages = {}
  process.env.TAVILY_API_KEY = 'test-tavily-key'
  delete process.env.SERPER_API_KEY
  delete process.env.FIRECRAWL_API_KEY
  mockedSearchTavily.mockReset()

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const domain = new URL(url).hostname
    const page = pages[domain]
    if (!page) {
      return { ok: false, status: 404, text: async () => '' } as Response
    }
    return {
      ok: true,
      status: 200,
      text: async () => htmlPage(page.title, page.description, page.body),
    } as Response
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TAVILY_API_KEY
  delete process.env.SERPER_API_KEY
  delete process.env.FIRECRAWL_API_KEY
})

function searchReturns(urls: string[]) {
  mockedSearchTavily.mockResolvedValue(
    urls.map(url => ({ title: '', url, content: '' }))
  )
}

// ── Pure helper: isKnownNonCorporateDomain ──────────────────────────

describe('isKnownNonCorporateDomain', () => {
  it('rejects .gov and country-code .gov.<cc> domains', () => {
    expect(isKnownNonCorporateDomain('usa.gov')).toBe(true)
    expect(isKnownNonCorporateDomain('petroleum.gov.gy')).toBe(true)
    expect(isKnownNonCorporateDomain('mca.gov.in')).toBe(true)
  })

  it('rejects known wiki-hosting domains', () => {
    expect(isKnownNonCorporateDomain('aitg.miraheze.org')).toBe(true)
    expect(isKnownNonCorporateDomain('en.wikipedia.org')).toBe(true)
  })

  it('rejects known directory/aggregator/social domains', () => {
    expect(isKnownNonCorporateDomain('www.linkedin.com')).toBe(true)
    expect(isKnownNonCorporateDomain('www.crunchbase.com')).toBe(true)
    expect(isKnownNonCorporateDomain('www.g2.com')).toBe(true)
  })

  it('does NOT reject a plain corporate-looking domain', () => {
    expect(isKnownNonCorporateDomain('adorwelding.com')).toBe(false)
    expect(isKnownNonCorporateDomain('a-1fenceproducts.com')).toBe(false)
  })
})

// ── Pure helper: wordsAppearTogether ─────────────────────────────────

describe('wordsAppearTogether', () => {
  it('is true when words appear in the same mention', () => {
    const text = 'Welcome to A-1 Fence Products Pvt Ltd, a leading manufacturer of fencing solutions.'
    expect(wordsAppearTogether(['a-1', 'fence', 'products'], text)).toBe(true)
  })

  it('is false when words appear individually but far apart / unrelated', () => {
    // Real shape of the live false positive: a generic petroleum-industry
    // government page mentions "petroleum" constantly, and "Anadarko" once,
    // in an unrelated sentence far from any "petroleum" mention.
    expect(wordsAppearTogether(['anadarko', 'petroleum'], farApartMentionsBody())).toBe(false)
  })

  it('is trivially true for single-word inputs', () => {
    expect(wordsAppearTogether(['aitg'], 'some unrelated text about AITG once')).toBe(true)
  })
})

// ── Pure helper: scoreCandidate ──────────────────────────────────────

describe('scoreCandidate', () => {
  it('scores a full title match as high confidence', () => {
    const identity: HomepageIdentity = {
      title: 'Ador Welding Ltd - Manufacturer of Welding Consumables',
      description: '',
      bodySnippet: '',
    }
    const result = scoreCandidate(wordsFor('Ador Welding'), identity)
    expect(result.confidence).toBe('high')
  })

  it('scores a real body-only match (words together) as medium for a multi-word name', () => {
    const identity: HomepageIdentity = {
      title: 'Home',
      description: '',
      bodySnippet: 'Welcome to A-1 Fence Products Pvt Ltd, a leading manufacturer of fencing solutions across India.',
    }
    const result = scoreCandidate(wordsFor('A-1 Fence Products'), identity)
    expect(result.confidence).toBe('medium')
  })

  it('rejects a body-only match where the words are present but not together (the Anadarko Petroleum shape)', () => {
    const identity: HomepageIdentity = {
      title: 'Guyana Ministry of Natural Resources',
      description: '',
      bodySnippet: farApartMentionsBody(),
    }
    const result = scoreCandidate(wordsFor('Anadarko Petroleum'), identity)
    expect(result.confidence).toBe('none')
    expect(result.evidence).toMatch(/not together/)
  })

  it('refuses to confirm a single-word/acronym name on a body-only match', () => {
    const identity: HomepageIdentity = {
      title: 'Some Unrelated Wiki',
      description: '',
      bodySnippet: 'This page mentions AITG once in passing.',
    }
    const result = scoreCandidate(wordsFor('AITG'), identity)
    expect(result.confidence).toBe('none')
  })

  it('downgrades a partial title match to medium, not high ("Shree Balaji Fabricators")', () => {
    const identity: HomepageIdentity = {
      title: 'Shree Balaji Enterprises Pune',
      description: '',
      bodySnippet: '',
    }
    const result = scoreCandidate(wordsFor('Shree Balaji Fabricators'), identity)
    expect(result.confidence).toBe('medium')
  })

  it('does not require proximity for a partial title match (title itself is already short)', () => {
    const identity: HomepageIdentity = {
      title: 'Shree Balaji Enterprises Pune',
      description: '',
      bodySnippet: '',
    }
    const result = scoreCandidate(wordsFor('Shree Balaji Fabricators'), identity)
    // Would have been rejected by a naive "apply proximity everywhere" fix —
    // confirms the exemption for titleRatio >= 0.5 is intentional, not a gap.
    expect(result.confidence).not.toBe('none')
  })
})

// ── Full flow: discoverCompanyWebsite ────────────────────────────────

describe('discoverCompanyWebsite — end to end (search + fetch mocked)', () => {
  it('confirms Ador Welding at high confidence via a title match', async () => {
    searchReturns(['https://adorwelding.com'])
    pages['adorwelding.com'] = {
      title: 'Ador Welding Ltd - Manufacturer of Welding Consumables',
      description: '',
      body: '',
    }

    const result = await discoverCompanyWebsite('Ador Welding')
    expect(result.status).toBe('confirmed')
    expect(result.domain).toBe('adorwelding.com')
    expect(result.confidence).toBe('high')
  })

  it('confirms A-1 Fence Products at medium confidence via a real body match', async () => {
    searchReturns(['https://a-1fenceproducts.com'])
    pages['a-1fenceproducts.com'] = {
      title: 'Home',
      description: '',
      body: 'Welcome to A-1 Fence Products Pvt Ltd, a leading manufacturer of fencing solutions across India.',
    }

    const result = await discoverCompanyWebsite('A-1 Fence Products')
    expect(result.status).toBe('confirmed')
    expect(result.domain).toBe('a-1fenceproducts.com')
    expect(result.confidence).toBe('medium')
  })

  it('returns not_found for AITG (single-word guard, no title match anywhere)', async () => {
    searchReturns(['https://aitg.miraheze.org'])
    // Also exercises the new domain guard directly — miraheze.org is a
    // known wiki host, so this candidate is rejected before any fetch.
    const result = await discoverCompanyWebsite('AITG')
    expect(result.status).toBe('not_found')
    expect(result.domain).toBeNull()
  })

  it('returns ambiguous for a generic 2-word name with two equally-plausible domains ("Om Enterprises"-shaped)', async () => {
    searchReturns(['https://omenterprises1.com', 'https://omenterprises2.com'])
    pages['omenterprises1.com'] = { title: 'Om Enterprises - Trading Company', description: '', body: '' }
    pages['omenterprises2.com'] = { title: 'Om Enterprises Pvt Ltd', description: '', body: '' }

    const result = await discoverCompanyWebsite('Om Enterprises')
    expect(result.status).toBe('ambiguous')
    expect(result.domain).toBeNull()
  })

  it('downgrades to medium (not high) for a partial title match ("Shree Balaji Fabricators")', async () => {
    searchReturns(['https://shreebalaji.example'])
    pages['shreebalaji.example'] = { title: 'Shree Balaji Enterprises Pune', description: '', body: '' }

    const result = await discoverCompanyWebsite('Shree Balaji Fabricators')
    expect(result.status).toBe('confirmed')
    expect(result.confidence).toBe('medium')
  })

  it('returns ambiguous for a genuine real-world name collision ("A-1 Fence Products" vs "A-1 Fence Company", Anaheim)', async () => {
    searchReturns(['https://a-1fenceproducts.com', 'https://a1fence.com'])
    pages['a-1fenceproducts.com'] = { title: 'A-1 Fence - Home', description: '', body: '' }
    pages['a1fence.com'] = { title: 'A-1 Fence Company | Anaheim CA', description: '', body: '' }

    const result = await discoverCompanyWebsite('A-1 Fence Products')
    expect(result.status).toBe('ambiguous')
    expect(result.domain).toBeNull()
  })

  it('rejects "Anadarko Petroleum" resolving to a government domain instead of returning a false-positive medium confirmation', async () => {
    searchReturns(['https://petroleum.gov.gy'])
    // Deliberately no `pages['petroleum.gov.gy']` entry — the domain guard
    // must reject this before any fetch is attempted at all.
    const result = await discoverCompanyWebsite('Anadarko Petroleum')
    expect(result.status).toBe('not_found')
    expect(result.domain).toBeNull()
    expect(result.candidates[0].evidence).toMatch(/known non-corporate domain/)
  })

  it('rejects Anadarko Petroleum even if the government-domain guard were absent, via the proximity requirement', async () => {
    // Defense in depth: simulate a differently-named (non-.gov) but equally
    // generic portal that the domain-pattern guard would NOT catch, to
    // confirm the word-proximity check independently blocks the same false
    // positive shape.
    searchReturns(['https://oilindustryportal.example'])
    pages['oilindustryportal.example'] = {
      title: 'Oil Industry Portal',
      description: '',
      body: farApartMentionsBody(),
    }

    const result = await discoverCompanyWebsite('Anadarko Petroleum')
    expect(result.status).toBe('not_found')
    expect(result.domain).toBeNull()
  })
})
