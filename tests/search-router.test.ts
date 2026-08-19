// ============================================================
// Search Router (G7) — unit tests
// ============================================================
// Mocks every dependency the router calls out to (search cache, Gemini
// Search grounding, Serper, Tavily) — same "mock the collaborators, test
// the orchestration" discipline as tests/website-discovery.test.ts.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/cache/search-cache', () => ({
  getCachedSearch: vi.fn(),
}))
vi.mock('../lib/enrichment/discovery-engine', () => ({
  searchSerper: vi.fn(),
  searchTavily: vi.fn(),
}))
vi.mock('@/lib/ai/providers/vertex-gemini-search', () => ({
  getCachedGeminiSearch: vi.fn(),
  searchWithGeminiGrounding: vi.fn(),
}))

import { getCachedSearch } from '@/lib/cache/search-cache'
import { searchSerper, searchTavily } from '../lib/enrichment/discovery-engine'
import { getCachedGeminiSearch, searchWithGeminiGrounding } from '@/lib/ai/providers/vertex-gemini-search'
import { isSearchSufficient, routedSearch, type SearchResultItem } from '../lib/enrichment/search-router'

const mockedGetCachedSearch = vi.mocked(getCachedSearch)
const mockedSearchSerper = vi.mocked(searchSerper)
const mockedSearchTavily = vi.mocked(searchTavily)
const mockedGetCachedGeminiSearch = vi.mocked(getCachedGeminiSearch)
const mockedSearchWithGeminiGrounding = vi.mocked(searchWithGeminiGrounding)

function result(url: string, content = 'a'.repeat(50)): SearchResultItem {
  return { title: url, url, content }
}

function sufficientSet(n = 3): SearchResultItem[] {
  return Array.from({ length: n }, (_, i) => result(`https://example.com/${i}`))
}

describe('isSearchSufficient', () => {
  it('is false below the default minResults floor', () => {
    expect(isSearchSufficient([result('a'), result('b')])).toBe(false)
  })

  it('is true at the default minResults floor with real content', () => {
    expect(isSearchSufficient(sufficientSet(3))).toBe(true)
  })

  it('does not count near-empty content toward the floor', () => {
    const results = [result('a', 'short'), result('b', 'short'), result('c', 'short')]
    expect(isSearchSufficient(results)).toBe(false)
  })

  it('respects a custom minResults override', () => {
    expect(isSearchSufficient(sufficientSet(3), { minResults: 5 })).toBe(false)
    expect(isSearchSufficient(sufficientSet(5), { minResults: 5 })).toBe(true)
  })

  it('respects a custom minContentChars override', () => {
    const results = [result('a', 'short'), result('b', 'short'), result('c', 'short')]
    expect(isSearchSufficient(results, { minContentChars: 4 })).toBe(true)
  })
})

describe('routedSearch', () => {
  // Explicit env-var isolation — routedSearch() falls back to
  // process.env.{TAVILY,SERPER,GEMINI_VERTEX}_API_KEY whenever a caller
  // passes an explicit `undefined` for that option, so a stray real value
  // in the test-runner's own shell environment must never leak into a
  // "this tier is unconfigured" assertion below.
  const envKeys = ['TAVILY_API_KEY', 'SERPER_API_KEY', 'GEMINI_VERTEX_API_KEY'] as const
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k]
      delete process.env[k]
    }
    mockedGetCachedSearch.mockReset().mockResolvedValue(null)
    mockedSearchSerper.mockReset().mockResolvedValue([])
    mockedSearchTavily.mockReset().mockResolvedValue([])
    mockedGetCachedGeminiSearch.mockReset().mockReturnValue(null)
    mockedSearchWithGeminiGrounding.mockReset().mockResolvedValue([])
  })

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  const opts = { tavilyApiKey: 'tk', serperApiKey: 'sk', geminiApiKey: 'gk' }

  it('stops at the cache tier when cached results are already sufficient', async () => {
    mockedGetCachedGeminiSearch.mockReturnValue(sufficientSet(3))

    const res = await routedSearch('query', opts)

    expect(res.sufficientAt).toBe('cache')
    expect(res.triedTiers).toEqual(['cache'])
    expect(mockedSearchWithGeminiGrounding).not.toHaveBeenCalled()
    expect(mockedSearchSerper).not.toHaveBeenCalled()
    expect(mockedSearchTavily).not.toHaveBeenCalled()
  })

  it('falls through to Gemini Search when the cache is empty, and stops there if sufficient', async () => {
    mockedSearchWithGeminiGrounding.mockResolvedValue(sufficientSet(3))

    const res = await routedSearch('query', opts)

    expect(res.sufficientAt).toBe('gemini_search')
    expect(res.triedTiers).toEqual(['cache', 'gemini_search'])
    expect(mockedSearchSerper).not.toHaveBeenCalled()
    expect(mockedSearchTavily).not.toHaveBeenCalled()
  })

  it('falls through to Serper when Gemini is insufficient, and stops there if sufficient', async () => {
    mockedSearchWithGeminiGrounding.mockResolvedValue([result('gemini-1')]) // insufficient (1 result)
    mockedSearchSerper.mockResolvedValue(sufficientSet(3))

    const res = await routedSearch('query', opts)

    expect(res.sufficientAt).toBe('serper')
    expect(res.triedTiers).toEqual(['cache', 'gemini_search', 'serper'])
    expect(mockedSearchTavily).not.toHaveBeenCalled()
  })

  it('falls all the way through to Tavily, last in priority order, and stops there if sufficient', async () => {
    mockedSearchTavily.mockResolvedValue(sufficientSet(3))

    const res = await routedSearch('query', opts)

    expect(res.sufficientAt).toBe('tavily')
    expect(res.triedTiers).toEqual(['cache', 'gemini_search', 'serper', 'tavily'])
  })

  it('skips a tier outright when its API key is not configured', async () => {
    mockedSearchTavily.mockResolvedValue(sufficientSet(3))

    const res = await routedSearch('query', { tavilyApiKey: 'tk', serperApiKey: undefined, geminiApiKey: undefined })

    expect(res.triedTiers).toEqual(['cache', 'tavily'])
    expect(mockedSearchWithGeminiGrounding).not.toHaveBeenCalled()
    expect(mockedSearchSerper).not.toHaveBeenCalled()
  })

  it('returns the largest result set seen across tiers when nothing clears the sufficiency bar (never a hard empty if something was found)', async () => {
    mockedSearchWithGeminiGrounding.mockResolvedValue([result('gemini-1')])
    mockedSearchSerper.mockResolvedValue([result('serper-1'), result('serper-2')])
    mockedSearchTavily.mockResolvedValue([])

    const res = await routedSearch('query', opts)

    expect(res.sufficientAt).toBeNull()
    expect(res.results).toHaveLength(2)
    expect(res.results[0].url).toBe('serper-1')
  })

  it('returns [] with sufficientAt null when every tier is skipped/empty', async () => {
    const res = await routedSearch('query', { tavilyApiKey: undefined, serperApiKey: undefined, geminiApiKey: undefined })

    expect(res.results).toEqual([])
    expect(res.sufficientAt).toBeNull()
    expect(res.triedTiers).toEqual(['cache'])
  })

  it('reads env-var API keys by default when no explicit options are passed', async () => {
    const prevTavily = process.env.TAVILY_API_KEY
    process.env.TAVILY_API_KEY = 'env-tavily-key'
    mockedSearchTavily.mockResolvedValue(sufficientSet(3))

    try {
      const res = await routedSearch('query')
      expect(mockedSearchTavily).toHaveBeenCalledWith('query', 'env-tavily-key', 3)
      expect(res.sufficientAt).toBe('tavily')
    } finally {
      if (prevTavily === undefined) delete process.env.TAVILY_API_KEY
      else process.env.TAVILY_API_KEY = prevTavily
    }
  })
})
