import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getCompletionMock = vi.fn()

vi.mock('@/lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
}))

vi.mock('../lib/enrichment/discovery-engine', () => ({
  searchTavily: vi.fn(),
  searchSerper: vi.fn(),
}))

import { discoverICPSegmentsViaSearchSynthesis } from '@/lib/enrichment/icp-generator'
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

describe('discoverICPSegmentsViaSearchSynthesis', () => {
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
    const result = await discoverICPSegmentsViaSearchSynthesis('AS Agri and Aqua', 'sites.google.com/view/asagriaqua/home')
    expect(result.sufficiency).toBe('insufficient')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('regression: a scam/fraud-shaped source is excluded before the LLM ever sees it, reproducing the exact live-found bug', async () => {
    // Real live incident (2026-08-13): this exact shape of content (a
    // Facebook page titled "SCAM", describing the company defrauding
    // investors) was previously fed to the LLM, which quoted it correctly
    // (the quote WAS real) but misread it as evidence of a legitimate
    // "Investors" customer segment. The fix is a pre-LLM content filter,
    // not better quote verification — this test asserts the LLM is never
    // even called when every relevant result is scam-shaped.
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'As Agri and Aqua LLP (ASAA) SCAM',
        'https://www.facebook.com/p/As-Agri-and-Aqua-LLP-ASAA-SCAM-100093517399816/',
        'AS Agri and Aqua LLP (ASAA) has scammed thousands of people and this advocate has fooled people in the name of helping investors and have fled away with lakhs.',
      ),
    ])

    const result = await discoverICPSegmentsViaSearchSynthesis('AS Agri and Aqua', 'sites.google.com/view/asagriaqua/home')

    expect(getCompletionMock).not.toHaveBeenCalled()
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/scam\/fraud\/complaint content/)
    expect(result.segments).toEqual([])
  })

  it('keeps a segment whose evidence_quote genuinely appears in the fetched content, and populates real source_urls (deduped)', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'AS Agri and Aqua services',
        'https://example.com/asagriaqua-services',
        'AS Agri and Aqua supplies cage-culture aquaculture setups to commercial fish farmers across the region.',
      ),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      segments: [
        {
          name: 'Commercial fish farmers',
          reason: 'Cage-culture aquaculture customers.',
          evidence_quote: 'AS Agri and Aqua supplies cage-culture aquaculture setups to commercial fish farmers across the region.',
        },
      ],
    })))

    const result = await discoverICPSegmentsViaSearchSynthesis('AS Agri and Aqua', 'sites.google.com/view/asagriaqua/home')

    expect(result.sufficiency).toBe('sufficient')
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]).toMatchObject({
      name: 'Commercial fish farmers',
      confidence: 'high',
      source: 'search_synthesis',
      source_urls: ['https://example.com/asagriaqua-services'],
    })
  })

  it('discards a segment whose evidence_quote does not verify against the fetched content', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'AS Agri and Aqua about',
        'https://example.com/about',
        'AS Agri and Aqua operates in vertical farming and aquaculture.',
      ),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      segments: [
        {
          name: 'Hospitals and health systems',
          reason: 'Fabricated relationship not actually in the content.',
          evidence_quote: 'This exact sentence was never in the search results and is fabricated by the model to sound plausible.',
        },
      ],
    })))

    const result = await discoverICPSegmentsViaSearchSynthesis('AS Agri and Aqua', 'sites.google.com/view/asagriaqua/home')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.segments).toEqual([])
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Hospitals and health systems', reason: expect.stringMatching(/could not be verified/) })])
    )
  })

  it('filters out a self-name match via the shared classifySegmentRejection safety net', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult(
        'AS Agri and Aqua profile',
        'https://example.com/profile',
        'AS Agri and Aqua sells to urban retail grocers who buy fresh produce and farmed fish directly.',
      ),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      segments: [
        { name: 'AS Agri and Aqua', reason: 'n/a', evidence_quote: 'AS Agri and Aqua sells to urban retail grocers who buy fresh produce and farmed fish directly.' },
        { name: 'Urban retail grocers', reason: 'Buys produce and fish directly.', evidence_quote: 'AS Agri and Aqua sells to urban retail grocers who buy fresh produce and farmed fish directly.' },
      ],
    })))

    const result = await discoverICPSegmentsViaSearchSynthesis('AS Agri and Aqua', 'sites.google.com/view/asagriaqua/home')
    expect(result.segments.map(s => s.name)).toEqual(['Urban retail grocers'])
  })

  it('returns insufficient (never throws) when the LLM returns an empty segments array', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult('AS Agri and Aqua', 'https://example.com', 'Some real but unremarkable content about AS Agri and Aqua.'),
    ])
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({ segments: [] })))

    const result = await discoverICPSegmentsViaSearchSynthesis('AS Agri and Aqua', 'sites.google.com/view/asagriaqua/home')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/no customer segment named/)
  })

  it('returns insufficient (never throws) when the LLM call fails', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult('AS Agri and Aqua', 'https://example.com', 'Some real content about AS Agri and Aqua.'),
    ])
    getCompletionMock.mockRejectedValue(new Error('network error'))

    const result = await discoverICPSegmentsViaSearchSynthesis('AS Agri and Aqua', 'sites.google.com/view/asagriaqua/home')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/call failed/)
  })

  it('returns insufficient (never throws) when the response is unparseable JSON', async () => {
    mockedSearchTavily.mockResolvedValue([
      searchResult('AS Agri and Aqua', 'https://example.com', 'Some real content about AS Agri and Aqua.'),
    ])
    getCompletionMock.mockResolvedValue(mockResponse('not json at all'))

    const result = await discoverICPSegmentsViaSearchSynthesis('AS Agri and Aqua', 'sites.google.com/view/asagriaqua/home')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/unparseable/)
  })
})
