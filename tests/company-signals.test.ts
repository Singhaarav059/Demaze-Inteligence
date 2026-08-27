import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/provider-factory', () => ({ getGroundedCompletion: vi.fn() }))

import { getGroundedCompletion } from '@/lib/ai/provider-factory'
import { researchCompanySignals } from '@/lib/research/company-signals'
import { CONFIRMED_SERVICE_NAMES } from '@/lib/pipeline/opportunity-engine'

const mockGrounded = vi.mocked(getGroundedCompletion)

describe('researchCompanySignals', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires a company name', async () => {
    const result = await researchCompanySignals({ name: '' })
    expect(result.error).toBeTruthy()
    expect(mockGrounded).not.toHaveBeenCalled()
  })

  it('parses a clean grounded response, filters signals to at most 5, drops invalid opportunity services', async () => {
    mockGrounded.mockResolvedValue({
      content: JSON.stringify({
        signals: [
          { title: 'Expansion', description: 'New facility', date: '2026-08-01', sourceUrl: 'https://x.com/a', recency: 'very_recent', confidence: 'high' },
          { title: 'Bad signal', description: 'missing recency/confidence falls back to defaults' },
        ],
        what_this_suggests: 'Scaling up',
        potential_pain_points: ['Coordination overhead', 42],
        opportunities: [
          { service: CONFIRMED_SERVICE_NAMES[0], evidence: 'e', interpretation: 'i', opportunity: 'o' },
          { service: 'Not a real service', evidence: 'e', interpretation: 'i', opportunity: 'o' },
        ],
        why_contact_now: 'They are scaling',
      }),
      model: 'gemini-3.6-flash', providerName: 'gemini_vertex', tokensUsed: 10, latencyMs: 5,
      groundingSources: [{ uri: 'https://x.com/a', title: 'Source' }],
    })

    const result = await researchCompanySignals({ name: 'ABC Automotive' })
    expect(result.signals).toHaveLength(2)
    expect(result.signals[0].confidence).toBe('high')
    expect(result.signals[1].confidence).toBe('low') // invalid -> safe default
    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0].service).toBe(CONFIRMED_SERVICE_NAMES[0])
    expect(result.potentialPainPoints).toEqual(['Coordination overhead']) // non-string dropped
    expect(result.whyContactNow).toBe('They are scaling')
    expect(result.groundingSources).toEqual([{ uri: 'https://x.com/a', title: 'Source' }])
  })

  it('handles a fence-wrapped "no signals found" response honestly', async () => {
    mockGrounded.mockResolvedValue({
      content: '```json\n{"signals": [], "what_this_suggests": null, "potential_pain_points": [], "opportunities": [], "why_contact_now": null}\n```',
      model: 'gemini-3.6-flash', providerName: 'gemini_vertex', tokensUsed: 5, latencyMs: 5,
    })
    const result = await researchCompanySignals({ name: 'Obscure Co' })
    expect(result.signals).toEqual([])
    expect(result.whyContactNow).toBeNull()
    expect(result.error).toBeUndefined()
  })

  it('never throws on a completion failure or malformed JSON', async () => {
    mockGrounded.mockRejectedValue(new Error('Grounded search unavailable'))
    const r1 = await researchCompanySignals({ name: 'X' })
    expect(r1.error).toContain('unavailable')

    mockGrounded.mockResolvedValue({ content: 'not json at all', model: 'm', providerName: 'p', tokensUsed: 0, latencyMs: 0 })
    const r2 = await researchCompanySignals({ name: 'X' })
    expect(r2.error).toBeTruthy()
    expect(r2.signals).toEqual([])
  })

  // Scenario 10: the 4096 -> 6144 token retry-on-truncation path
  // (callAndParse) — live-tested to fire on real, non-deterministic JSON
  // truncation, but previously untested at unit level (company-signals
  // .test.ts only mocked getGroundedCompletion itself, one layer above the
  // retry). First call throws (simulating a truncated-JSON parse failure by
  // returning invalid JSON), second call at the larger budget succeeds.
  it('scenario 10: retries once at a larger token budget when the first response fails to parse, and succeeds', async () => {
    mockGrounded
      .mockResolvedValueOnce({ content: '{"signals": [truncated', model: 'm', providerName: 'p', tokensUsed: 0, latencyMs: 0 })
      .mockResolvedValueOnce({
        content: JSON.stringify({ signals: [], what_this_suggests: null, potential_pain_points: [], opportunities: [], why_contact_now: null }),
        model: 'm', providerName: 'p', tokensUsed: 0, latencyMs: 0,
      })

    const result = await researchCompanySignals({ name: 'Retry Co' })

    expect(mockGrounded).toHaveBeenCalledTimes(2)
    expect(mockGrounded.mock.calls[0][0]).toMatchObject({ maxTokens: 4096 })
    expect(mockGrounded.mock.calls[1][0]).toMatchObject({ maxTokens: 6144 })
    expect(result.error).toBeUndefined()
    expect(result.signals).toEqual([])
  })

  it('scenario 10: still returns an honest error if the retry at the larger budget also fails', async () => {
    mockGrounded.mockResolvedValue({ content: 'still not json', model: 'm', providerName: 'p', tokensUsed: 0, latencyMs: 0 })
    const result = await researchCompanySignals({ name: 'Still Broken Co' })
    expect(mockGrounded).toHaveBeenCalledTimes(2)
    expect(result.error).toBeTruthy()
  })

  // Scenario 11: sourceUrl is the model's own citation, never a mechanically
  // verified one by default — sourceVerified is only ever set true when it
  // genuinely matches a real groundingSources entry from the same response.
  describe('sourceVerified — source URL handling', () => {
    it('scenario 11: marks a signal verified only when its sourceUrl matches a real groundingSources entry', async () => {
      mockGrounded.mockResolvedValue({
        content: JSON.stringify({
          signals: [
            { title: 'Matches', description: 'd', sourceUrl: 'https://example.com/news/a', recency: 'recent', confidence: 'high' },
            { title: 'No match', description: 'd', sourceUrl: 'https://unrelated.com/x', recency: 'recent', confidence: 'high' },
            { title: 'No sourceUrl at all', description: 'd', recency: 'recent', confidence: 'high' },
          ],
          what_this_suggests: null, potential_pain_points: [], opportunities: [], why_contact_now: null,
        }),
        model: 'm', providerName: 'p', tokensUsed: 0, latencyMs: 0,
        groundingSources: [{ uri: 'https://www.example.com/news/a/', title: 'Real source' }],
      })

      const result = await researchCompanySignals({ name: 'Verify Co' })
      const matches = result.signals.find(s => s.title === 'Matches')
      const noMatch = result.signals.find(s => s.title === 'No match')
      const noUrl = result.signals.find(s => s.title === 'No sourceUrl at all')

      expect(matches?.sourceVerified).toBe(true)
      expect(noMatch?.sourceVerified).toBeUndefined()
      expect(noUrl?.sourceVerified).toBeUndefined()
    })

    it('scenario 11: never fabricates sourceVerified when groundingSources is empty/absent', async () => {
      mockGrounded.mockResolvedValue({
        content: JSON.stringify({
          signals: [{ title: 'Alone', description: 'd', sourceUrl: 'https://example.com/x', recency: 'recent', confidence: 'high' }],
          what_this_suggests: null, potential_pain_points: [], opportunities: [], why_contact_now: null,
        }),
        model: 'm', providerName: 'p', tokensUsed: 0, latencyMs: 0,
      })
      const result = await researchCompanySignals({ name: 'No Grounding Co' })
      expect(result.signals[0].sourceVerified).toBeUndefined()
    })
  })
})
