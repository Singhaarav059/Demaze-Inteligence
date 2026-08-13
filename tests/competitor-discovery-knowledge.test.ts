import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCompletionMock = vi.fn()

vi.mock('@/lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
}))

import { discoverCompetitorsFromKnowledge } from '@/lib/enrichment/competitor-discovery'

function mockResponse(content: string) {
  return {
    content,
    model: 'test-model',
    providerName: 'test-provider',
    tokensUsed: 100,
    latencyMs: 10,
  }
}

describe('discoverCompetitorsFromKnowledge', () => {
  beforeEach(() => {
    getCompletionMock.mockReset()
  })

  it('returns insufficient without calling the LLM when companyName is empty', async () => {
    const result = await discoverCompetitorsFromKnowledge('', 'example.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('parses a confident response into CompetitorProfile[], tagged source: ai_knowledge', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      competitors: [
        { name: 'ESAB India Ltd', market_segment: 'Direct domestic competitor', why_they_compete: 'Welding consumables and arc equipment.', well_known: true },
        { name: 'Diffusion Engineers Ltd', market_segment: 'Domestic manufacturer', why_they_compete: 'Welding consumables and wear plates.', well_known: false },
      ],
    })))

    const result = await discoverCompetitorsFromKnowledge('Ador Welding', 'adorwelding.com')

    expect(result.sufficiency).toBe('sufficient')
    expect(result.competitors).toHaveLength(2)
    expect(result.candidates).toEqual([])
    expect(result.competitors[0]).toMatchObject({
      name: 'ESAB India Ltd',
      market_position: 'Direct domestic competitor',
      why_they_compete: 'Welding consumables and arc equipment.',
      confidence: 'high',
      source_urls: [],
      source: 'ai_knowledge',
    })
    expect(result.competitors[1].confidence).toBe('medium')
  })

  it('caps results at 8 competitors, preserving order', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      competitors: Array.from({ length: 10 }, (_, i) => ({
        name: `Rival Industries ${i}`,
        market_segment: 'segment',
        why_they_compete: 'reason',
        well_known: true,
      })),
    })))

    const result = await discoverCompetitorsFromKnowledge('Acme Corp', 'acmecorp.com')
    expect(result.competitors).toHaveLength(8)
    expect(result.competitors[0].name).toBe('Rival Industries 0')
    expect(result.competitors[7].name).toBe('Rival Industries 7')
  })

  it('returns insufficient when the LLM declines (has_knowledge: false)', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: false,
      competitors: [],
    })))

    const result = await discoverCompetitorsFromKnowledge('Obscure Local Fabricators Pvt Ltd', 'example.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/declined/i)
    expect(result.competitors).toEqual([])
  })

  it('filters out a self-name match via the same classifyRejection safety net search candidates use', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      competitors: [
        { name: 'Ace Pipeline', market_segment: 'n/a', why_they_compete: 'n/a', well_known: true },
        { name: 'Bechtel Corporation', market_segment: 'Global EPC competitor', why_they_compete: 'Large-scale pipeline construction.', well_known: true },
      ],
    })))

    const result = await discoverCompetitorsFromKnowledge('Ace Pipeline', 'acepipeline.com')
    expect(result.competitors.map(c => c.name)).toEqual(['Bechtel Corporation'])
    expect(result.rejected_candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Ace Pipeline', reason: expect.stringMatching(/self-name/) })])
    )
  })

  it('filters out a known directory/aggregator name', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      competitors: [
        { name: 'LinkedIn', market_segment: 'n/a', why_they_compete: 'n/a', well_known: true },
        { name: 'Lincoln Electric', market_segment: 'Global arc welding equipment', why_they_compete: 'Industrial welding equipment maker.', well_known: true },
      ],
    })))

    const result = await discoverCompetitorsFromKnowledge('Ador Welding', 'adorwelding.com')
    expect(result.competitors.map(c => c.name)).toEqual(['Lincoln Electric'])
  })

  it('returns insufficient (never throws) when every candidate is rejected', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      has_knowledge: true,
      competitors: [
        { name: 'Ador Welding', market_segment: 'n/a', why_they_compete: 'n/a', well_known: true },
      ],
    })))

    const result = await discoverCompetitorsFromKnowledge('Ador Welding', 'adorwelding.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/all were rejected/)
  })

  it('strips ```json fences before parsing', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(
      '```json\n' + JSON.stringify({
        has_knowledge: true,
        competitors: [{ name: 'Real Competitor Inc', market_segment: 'x', why_they_compete: 'y', well_known: true }],
      }) + '\n```',
    ))

    const result = await discoverCompetitorsFromKnowledge('Some Company', 'somecompany.com')
    expect(result.sufficiency).toBe('sufficient')
    expect(result.competitors[0].name).toBe('Real Competitor Inc')
  })

  it('returns insufficient (never throws) when the LLM call fails', async () => {
    getCompletionMock.mockRejectedValue(new Error('network error'))
    const result = await discoverCompetitorsFromKnowledge('Some Company', 'somecompany.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/call failed/)
  })

  it('returns insufficient (never throws) when the response is unparseable JSON', async () => {
    getCompletionMock.mockResolvedValue(mockResponse('not json at all'))
    const result = await discoverCompetitorsFromKnowledge('Some Company', 'somecompany.com')
    expect(result.sufficiency).toBe('insufficient')
    expect(result.reason).toMatch(/unparseable/)
  })
})
