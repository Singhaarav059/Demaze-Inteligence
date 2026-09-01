// ============================================================
// Exa Decision-Maker Discovery Provider — tests
// ============================================================
// lib/enrichment/sources/exa-client.ts and the credential helper are both
// mocked entirely — no live network call, no dependency on EXA_API_KEY
// being set. Mirrors tests/decision-maker-discovery-prospeo.test.ts's
// structure (request construction, response normalization, dropped
// non-matches, isAvailable).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/enrichment/sources/exa-client', () => ({
  exaSearch: vi.fn(),
}))

vi.mock('@/lib/outbound/shared/exa-outbound-client', () => ({
  getExaCredential: vi.fn(),
}))

import { exaSearch } from '@/lib/enrichment/sources/exa-client'
import { getExaCredential } from '@/lib/outbound/shared/exa-outbound-client'
import { ExaDecisionMakerDiscoveryProvider } from '@/lib/outbound/decision-maker-discovery/providers/exa'

describe('ExaDecisionMakerDiscoveryProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('errors without a companyName or domain', async () => {
    const result = await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({ companyName: '', domain: '' })
    expect(result.status).toBe('error')
  })

  it('errors with no API key configured', async () => {
    vi.mocked(getExaCredential).mockResolvedValue(null)
    const result = await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
    })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('API key')
  })

  it('sends a category:people search with target titles in the query', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaSearch).mockResolvedValue({ requestId: 'r1', results: [] })

    await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CTO'],
    })

    const [params, key] = vi.mocked(exaSearch).mock.calls[0]
    expect(params.category).toBe('people')
    expect(params.query).toContain('CTO')
    expect(params.query).toContain('Acme')
    expect(key).toBe('key')
  })

  it('uses structured output.content when Exa returns it', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaSearch).mockResolvedValue({
      requestId: 'r1',
      results: [],
      output: {
        content: {
          candidates: [{ name: 'Jane Doe', title: 'Chief Technology Officer', linkedinUrl: 'https://linkedin.com/in/janedoe' }],
        },
      },
    })

    const result = await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CTO'],
    })

    expect(result.status).toBe('found')
    expect(result.candidates).toEqual([
      {
        personName: 'Jane Doe',
        title: 'CTO',
        linkedinUrl: 'https://linkedin.com/in/janedoe',
        confidence: 'high',
      },
    ])
  })

  it('falls back to parsing raw result titles when no structured output is present', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaSearch).mockResolvedValue({
      requestId: 'r1',
      results: [
        {
          id: '1',
          url: 'https://www.linkedin.com/in/johnsmith',
          title: 'John Smith - Chief Executive Officer - Acme Corp | LinkedIn',
          publishedDate: null,
          author: null,
          image: null,
          favicon: null,
        },
      ],
    })

    const result = await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CEO'],
    })

    expect(result.status).toBe('found')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      personName: 'John Smith',
      title: 'CEO',
      linkedinUrl: 'https://www.linkedin.com/in/johnsmith',
    })
  })

  it('does not fabricate a candidate from a raw result with no dash-delimited title', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaSearch).mockResolvedValue({
      requestId: 'r1',
      results: [
        { id: '1', url: 'https://example.com/about', title: 'About Us', publishedDate: null, author: null, image: null, favicon: null },
      ],
    })

    const result = await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CEO'],
    })

    expect(result.status).toBe('not_found')
    expect(result.candidates).toEqual([])
  })

  it('keeps a raw candidate whose parsed title shares no word with any requested title — real title, honest low confidence, never dropped', async () => {
    // Regression for a real benchmark finding: Amit Kalyani (Bharat Forge)
    // was a genuine, correctly-identified person whose real title
    // ("Vice-Chairman and Joint Managing Director") shared no word with any
    // of the 8 requested phrases — dropping him entirely would throw away a
    // real find; forcing him into a requested phrase would mislabel him.
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaSearch).mockResolvedValue({
      requestId: 'r1',
      results: [
        {
          id: '1',
          url: 'https://www.linkedin.com/in/irrelevant',
          title: 'Pat Lee - Receptionist - Acme Corp | LinkedIn',
          publishedDate: null,
          author: null,
          image: null,
          favicon: null,
        },
      ],
    })

    const result = await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CEO'],
    })

    expect(result.status).toBe('found')
    expect(result.candidates).toEqual([
      { personName: 'Pat Lee', title: 'Receptionist', linkedinUrl: 'https://www.linkedin.com/in/irrelevant', confidence: 'low' },
    ])
  })

  it('never throws when exaSearch rejects', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaSearch).mockRejectedValue(new Error('network blip'))

    const result = await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
    })

    expect(result.status).toBe('error')
    expect(result.reason).toBe('network blip')
  })

  it('isAvailable reflects whether a credential is configured', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    expect(await ExaDecisionMakerDiscoveryProvider.isAvailable()).toBe(true)

    vi.mocked(getExaCredential).mockResolvedValue(null)
    expect(await ExaDecisionMakerDiscoveryProvider.isAvailable()).toBe(false)
  })
})
