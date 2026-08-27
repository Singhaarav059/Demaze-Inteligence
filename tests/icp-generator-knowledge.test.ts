import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCompletionMock = vi.fn()

vi.mock('@/lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
}))

import { discoverICPSegmentsFromKnowledge } from '@/lib/enrichment/icp-generator'

function mockResponse(content: string) {
  return {
    content,
    model: 'test-model',
    providerName: 'test-provider',
    tokensUsed: 100,
    latencyMs: 10,
  }
}

describe('discoverICPSegmentsFromKnowledge', () => {
  beforeEach(() => {
    getCompletionMock.mockReset()
  })

  it('returns insufficient without calling the LLM when companyName is empty', async () => {
    const result = await discoverICPSegmentsFromKnowledge('', 'example.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('parses a confident response into ICPSegment[], tagged source: ai_knowledge', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      segments: [
        { name: 'Automotive OEMs', reason: 'Ador Welding supplies consumables used in automotive assembly welding.', use_case: 'Assembly-line arc welding consumables', priority: 'high', confident: true },
        { name: 'Shipbuilding yards', reason: 'Supplies welding equipment for hull fabrication.', use_case: 'Hull fabrication welding', priority: 'medium', confident: false },
      ],
    })))

    const result = await discoverICPSegmentsFromKnowledge('Ador Welding', 'adorwelding.com')

    expect(result.sufficiency).toBe('sufficient')
    expect(result.segments).toHaveLength(2)
    expect(result.candidates).toEqual([])
    // Reliability pass item 5: this tier has zero source_urls by
    // construction (direct LLM knowledge, never search-grounded) — it can
    // never legitimately claim 'high' confidence, which research-quality
    // .ts's own audit asserts requires 2+ source URLs. `confident` still
    // conveys a real distinction, capped one notch below where it used to be.
    expect(result.segments[0]).toMatchObject({
      name: 'Automotive OEMs',
      reason: 'Ador Welding supplies consumables used in automotive assembly welding.',
      use_cases: 'Assembly-line arc welding consumables',
      priority: 'high',
      market_attractiveness: 'high',
      confidence: 'medium',
      signals: [],
      source_urls: [],
      source: 'ai_knowledge',
    })
    expect(result.segments[1].confidence).toBe('low')
  })

  it('populates criteria and example_companies when the segment is confident', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      segments: [
        {
          name: 'Government & Public Sector Bodies',
          reason: 'Real reason.',
          use_case: 'Turnkey EPC for mega-infrastructure',
          criteria: 'Central/state ministries, public transport authorities',
          example_companies: ['DMRC', 'NHAI'],
          priority: 'high',
          confident: true,
        },
      ],
    })))

    const result = await discoverICPSegmentsFromKnowledge('Larsen & Toubro', 'larsentoubro.com')
    expect(result.segments[0].criteria).toBe('Central/state ministries, public transport authorities')
    expect(result.segments[0].example_companies).toEqual(['DMRC', 'NHAI'])
  })

  it('withholds example_companies (but keeps criteria) when the segment is not confident, even if the LLM returned names anyway', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      segments: [
        {
          name: 'Energy & Utility Giants',
          reason: 'Real reason.',
          use_case: 'Power grids',
          criteria: 'Large capex energy operators',
          example_companies: ['Guessed Client Corp'],
          priority: 'medium',
          confident: false,
        },
      ],
    })))

    const result = await discoverICPSegmentsFromKnowledge('Larsen & Toubro', 'larsentoubro.com')
    expect(result.segments[0].criteria).toBe('Large capex energy operators')
    expect(result.segments[0].example_companies).toBeUndefined()
  })

  it('caps example_companies at 5 and filters out non-string entries', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      segments: [
        {
          name: 'Large Enterprise Clients',
          reason: 'Real reason.',
          use_case: 'Heavy civil construction',
          example_companies: ['A', 'B', 'C', 'D', 'E', 'F', 42, null, '  '],
          priority: 'high',
          confident: true,
        },
      ],
    })))

    const result = await discoverICPSegmentsFromKnowledge('Larsen & Toubro', 'larsentoubro.com')
    expect(result.segments[0].example_companies).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('caps results at MAX_SEGMENTS (5), preserving order', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      segments: Array.from({ length: 8 }, (_, i) => ({
        name: `Target Segment ${i}`,
        reason: 'reason',
        use_case: 'use case',
        priority: 'medium',
        confident: true,
      })),
    })))

    const result = await discoverICPSegmentsFromKnowledge('Acme Corp', 'acmecorp.com')
    expect(result.segments).toHaveLength(5)
    expect(result.segments[0].name).toBe('Target Segment 0')
    expect(result.segments[4].name).toBe('Target Segment 4')
  })

  it('returns insufficient when the LLM declines (has_knowledge: false)', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: false,
      segments: [],
    })))

    const result = await discoverICPSegmentsFromKnowledge('Obscure Local Fabricators Pvt Ltd', 'example.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/declined/i)
    expect(result.segments).toEqual([])
  })

  it('filters out a self-name match via the same classifySegmentRejection safety net search candidates use', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      segments: [
        { name: 'Ace Pipeline', reason: 'n/a', use_case: 'n/a', priority: 'low', confident: true },
        { name: 'Oil and gas midstream operators', reason: 'Real segment.', use_case: 'Pipeline construction', priority: 'high', confident: true },
      ],
    })))

    const result = await discoverICPSegmentsFromKnowledge('Ace Pipeline', 'acepipeline.com')
    expect(result.segments.map(s => s.name)).toEqual(['Oil and gas midstream operators'])
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Ace Pipeline', reason: expect.stringMatching(/self-name/) })])
    )
  })

  it('filters out a generic/stopword-only segment name', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      segments: [
        { name: 'Customers', reason: 'n/a', use_case: 'n/a', priority: 'low', confident: true },
        { name: 'Automotive OEMs', reason: 'Real segment.', use_case: 'Assembly welding', priority: 'high', confident: true },
      ],
    })))

    const result = await discoverICPSegmentsFromKnowledge('Ador Welding', 'adorwelding.com')
    expect(result.segments.map(s => s.name)).toEqual(['Automotive OEMs'])
  })

  it('returns insufficient (never throws) when every candidate is rejected', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      segments: [
        { name: 'Ador Welding', reason: 'n/a', use_case: 'n/a', priority: 'low', confident: true },
      ],
    })))

    const result = await discoverICPSegmentsFromKnowledge('Ador Welding', 'adorwelding.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/all were rejected/)
  })

  it('strips ```json fences before parsing', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(
      '```json\n' + JSON.stringify({
        has_knowledge: true,
        segments: [{ name: 'Real Segment', reason: 'x', use_case: 'y', priority: 'medium', confident: true }],
      }) + '\n```',
    ))

    const result = await discoverICPSegmentsFromKnowledge('Some Company', 'somecompany.com')
    expect(result.sufficiency).toBe('sufficient')
    expect(result.segments[0].name).toBe('Real Segment')
  })

  it('returns insufficient (never throws) when the LLM call fails', async () => {
    getCompletionMock.mockRejectedValue(new Error('network error'))
    const result = await discoverICPSegmentsFromKnowledge('Some Company', 'somecompany.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/call failed/)
  })

  it('returns insufficient (never throws) when the response is unparseable JSON', async () => {
    getCompletionMock.mockResolvedValue(mockResponse('not json at all'))
    const result = await discoverICPSegmentsFromKnowledge('Some Company', 'somecompany.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/unparseable/)
  })
})
