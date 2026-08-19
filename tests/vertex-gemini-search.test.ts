// ============================================================
// Gemini Search Grounding — unit tests
// ============================================================
// Mocks @google/genai's GoogleGenAI class directly (no precedent for this
// in the repo yet — same "mock the external SDK, not our own wrapper"
// discipline as tests/prospeo-client.test.ts mocking global.fetch).
// Live-verification against a real Vertex Express Mode key is explicitly
// deferred — see docs/search-router-design.md.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateContentMock = vi.fn()

vi.mock('@google/genai', () => ({
  // A regular `function`, not an arrow function — arrow functions can't be
  // used as constructors, and vertex-gemini-search.ts calls `new
  // GoogleGenAI(...)`, which throws "not a constructor" against an arrow-
  // function mock implementation.
  GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAIMock() {
    return { models: { generateContent: generateContentMock } }
  }),
  ThinkingLevel: { MINIMAL: 'MINIMAL' },
}))

import { searchWithGeminiGrounding } from '../lib/ai/providers/vertex-gemini-search'

function groundedResponse(
  chunks: Array<{ uri?: string; title?: string }>,
  text = 'Synthesized answer text.',
) {
  return {
    text,
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: chunks.map(c => ({ web: c })),
        },
      },
    ],
  }
}

describe('searchWithGeminiGrounding', () => {
  beforeEach(() => {
    generateContentMock.mockReset()
    // Each test uses a distinct query string so the module-scope cache
    // from a prior test can never leak into this one.
  })

  it('maps groundingChunks into search results with the model text as shared content', async () => {
    generateContentMock.mockResolvedValue(
      groundedResponse([
        { uri: 'https://a.com/page', title: 'Page A' },
        { uri: 'https://b.com/page', title: 'Page B' },
      ], 'Ador Welding operates six manufacturing facilities.'),
    )

    const results = await searchWithGeminiGrounding('unique query 1', 'fake-key', 5)

    expect(results).toEqual([
      { title: 'Page A', url: 'https://a.com/page', content: 'Ador Welding operates six manufacturing facilities.' },
      { title: 'Page B', url: 'https://b.com/page', content: 'Ador Welding operates six manufacturing facilities.' },
    ])
  })

  it('dedupes chunks that share the same URL', async () => {
    generateContentMock.mockResolvedValue(
      groundedResponse([
        { uri: 'https://a.com/page', title: 'Page A' },
        { uri: 'https://a.com/page', title: 'Page A (duplicate)' },
      ]),
    )

    const results = await searchWithGeminiGrounding('unique query 2', 'fake-key', 5)
    expect(results).toHaveLength(1)
  })

  it('skips chunks with no web.uri', async () => {
    generateContentMock.mockResolvedValue(
      groundedResponse([{ title: 'No URL here' }, { uri: 'https://c.com/page', title: 'Page C' }]),
    )

    const results = await searchWithGeminiGrounding('unique query 3', 'fake-key', 5)
    expect(results).toEqual([{ title: 'Page C', url: 'https://c.com/page', content: 'Synthesized answer text.' }])
  })

  it('caps results at maxResults', async () => {
    generateContentMock.mockResolvedValue(
      groundedResponse([
        { uri: 'https://a.com/1' }, { uri: 'https://a.com/2' }, { uri: 'https://a.com/3' },
      ]),
    )

    const results = await searchWithGeminiGrounding('unique query 4', 'fake-key', 2)
    expect(results).toHaveLength(2)
  })

  it('returns [] with no grounding chunks present', async () => {
    generateContentMock.mockResolvedValue({ text: 'No sources found.', candidates: [{}] })
    const results = await searchWithGeminiGrounding('unique query 5', 'fake-key', 3)
    expect(results).toEqual([])
  })

  it('returns [] (never throws) when the API call rejects', async () => {
    generateContentMock.mockRejectedValue(new Error('network error'))
    const results = await searchWithGeminiGrounding('unique query 6', 'fake-key', 3)
    expect(results).toEqual([])
  })

  it('caches a successful result and does not call generateContent again for the same query', async () => {
    generateContentMock.mockResolvedValue(groundedResponse([{ uri: 'https://a.com/page', title: 'Page A' }]))

    const first = await searchWithGeminiGrounding('unique query 7', 'fake-key', 3)
    expect(generateContentMock).toHaveBeenCalledTimes(1)

    const second = await searchWithGeminiGrounding('unique query 7', 'fake-key', 3)
    expect(generateContentMock).toHaveBeenCalledTimes(1) // still 1 — served from cache
    expect(second).toEqual(first)
  })

  it('does not cache an empty result (a transient failure should be retried on the next call)', async () => {
    generateContentMock.mockResolvedValueOnce({ text: '', candidates: [{}] })
    generateContentMock.mockResolvedValueOnce(groundedResponse([{ uri: 'https://a.com/page', title: 'Page A' }]))

    const first = await searchWithGeminiGrounding('unique query 8', 'fake-key', 3)
    expect(first).toEqual([])

    const second = await searchWithGeminiGrounding('unique query 8', 'fake-key', 3)
    expect(second).toHaveLength(1)
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })
})
