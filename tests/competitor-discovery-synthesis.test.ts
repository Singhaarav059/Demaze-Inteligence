import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getCompletionMock = vi.fn()

vi.mock('@/lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
}))

vi.mock('../lib/enrichment/discovery-engine', () => ({
  searchTavily: vi.fn(),
  searchSerper: vi.fn(),
}))

import { discoverCompetitorsViaSearchSynthesis } from '@/lib/enrichment/competitor-discovery'
import { searchTavily } from '../lib/enrichment/discovery-engine'

const mockedSearchTavily = vi.mocked(searchTavily)

function mockResponse(content: string) {
  return {
    content,
    model: 'test-model',
    providerName: 'test-provider',
    tokensUsed: 100,
    latencyMs: 10,
  }
}

function searchResult(title: string, url: string, content: string) {
  return { title, url, content }
}

describe('discoverCompetitorsViaSearchSynthesis', () => {
  beforeEach(() => {
    getCompletionMock.mockReset()
    mockedSearchTavily.mockReset()
    process.env.TAVILY_API_KEY = 'test-tavily-key'
    delete process.env.SERPER_API_KEY
  })

  afterEach(() => {
    delete process.env.TAVILY_API_KEY
    delete process.env.SERPER_API_KEY
  })

  it('returns insufficient without calling the LLM when search returns nothing', async () => {
    mockedSearchTavily.mockResolvedValue([])
    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')
    expect(result.sufficiency).toBe('insufficient')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('regression: a scam/fraud-shaped source is excluded before the LLM ever sees it (same live bug found via the ICP sibling module)', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'Ace Pipeline SCAM WARNING',
        'https://www.facebook.com/p/Ace-Pipeline-SCAM/',
        'Ace Pipeline has scammed thousands of people and fled away with lakhs, cheating investors and clients alike.',
      ),
    ])

    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')

    expect(getCompletionMock).not.toHaveBeenCalled()
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/scam\/fraud\/complaint content/)
    expect(result.competitors).toEqual([])
  })

  it('keeps a competitor whose evidence_quote genuinely appears in the fetched content, and populates real source_urls', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'Ace Pipeline vs Kalpataru Projects',
        'https://example.com/ace-pipeline-competitors',
        'Ace Pipeline competes directly with Kalpataru Projects International Limited on cross-country pipeline tenders in India.',
      ),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      competitors: [
        {
          name: 'Kalpataru Projects International Limited',
          why_they_compete: 'Direct EPC pipeline competitor.',
          evidence_quote: 'Ace Pipeline competes directly with Kalpataru Projects International Limited on cross-country pipeline tenders in India.',
        },
      ],
    })))

    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')

    expect(result.sufficiency).toBe('sufficient')
    expect(result.competitors).toHaveLength(1)
    expect(result.competitors[0]).toMatchObject({
      name: 'Kalpataru Projects International Limited',
      confidence: 'high',
      source: 'search_synthesis',
      source_urls: ['https://example.com/ace-pipeline-competitors'],
    })
  })

  it('discards a competitor whose evidence_quote does not verify against the fetched content, even if the name is real', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'About Ace Pipeline',
        'https://example.com/about',
        'Ace Pipeline is a cross-country pipeline EPC contractor based in India.',
      ),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      competitors: [
        {
          name: 'Larsen & Toubro',
          why_they_compete: 'Fabricated relationship not actually in the content.',
          evidence_quote: 'This exact sentence was never in the search results and is fabricated by the model to sound plausible.',
        },
      ],
    })))

    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.competitors).toEqual([])
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Larsen & Toubro', reason: expect.stringMatching(/could not be verified/) })])
    )
  })

  it('filters a self-name match via the shared classifyRejection safety net', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'Ace Pipeline profile',
        'https://example.com/profile',
        'Ace Pipeline and Bechtel Corporation both bid on the same large-scale pipeline construction tenders.',
      ),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      competitors: [
        { name: 'Ace Pipeline', why_they_compete: 'n/a', evidence_quote: 'Ace Pipeline and Bechtel Corporation both bid on the same large-scale pipeline construction tenders.' },
        { name: 'Bechtel Corporation', why_they_compete: 'Competes on the same tenders.', evidence_quote: 'Ace Pipeline and Bechtel Corporation both bid on the same large-scale pipeline construction tenders.' },
      ],
    })))

    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')
    expect(result.competitors.map(c => c.name)).toEqual(['Bechtel Corporation'])
  })

  it('accepts a close-paraphrase quote at medium confidence (fuzzy match tier)', async () => {
    // The claimed quote is NOT a literal substring of the content (there's
    // a real gap between "Ace Pipeline is" and "competing against" in the
    // source text below), so this must land on the 'close' tier via word-
    // overlap + a shared 4-word run ("competing against players such"), not
    // the 'exact' tier — deliberately distinct from the exact-match test
    // above so both confidence branches get real coverage.
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'Industry overview',
        'https://example.com/overview',
        'Ace Pipeline is one of several firms operating in the cross country pipeline construction space in India, competing against players such as Punj Lloyd for large infrastructure contracts nationwide.',
      ),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      competitors: [
        {
          name: 'Punj Lloyd',
          why_they_compete: 'Competes for the same pipeline contracts.',
          evidence_quote: 'Ace Pipeline is competing against players such as Punj Lloyd for large infrastructure contracts',
        },
      ],
    })))

    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')
    expect(result.sufficiency).toBe('sufficient')
    expect(result.competitors[0].confidence).toBe('medium')
  })

  it('returns insufficient (never throws) when the LLM returns an empty competitors array', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult('Ace Pipeline', 'https://example.com', 'Some real but unremarkable content about Ace Pipeline.'),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({ competitors: [] })))

    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/no competitor named/)
  })

  it('returns insufficient (never throws) when the LLM call fails', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult('Ace Pipeline', 'https://example.com', 'Some real content about Ace Pipeline.'),
    ])
    getCompletionMock.mockRejectedValue(new Error('network error'))

    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/call failed/)
  })

  it('returns insufficient (never throws) when the response is unparseable JSON', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult('Ace Pipeline', 'https://example.com', 'Some real content about Ace Pipeline.'),
    ])
    getCompletionMock.mockResolvedValue(mockResponse('not json at all'))

    const result = await discoverCompetitorsViaSearchSynthesis('Ace Pipeline', 'acepipeline.co.in')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/unparseable/)
  })
})
