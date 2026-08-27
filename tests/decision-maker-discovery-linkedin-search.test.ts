// ============================================================
// LinkedIn Search-Discovery Decision-Maker Provider — tests
// ============================================================
// lib/enrichment/discovery-engine.ts's searchTavily/searchSerper are mocked
// entirely, same precedent as tests/decision-maker-discovery-prospeo.test.ts,
// so these test query building, result filtering, and title-match
// confidence without a real network/search-API call.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/enrichment/discovery-engine', () => ({
  searchTavily: vi.fn(),
  searchSerper: vi.fn(),
}))

import { searchTavily, searchSerper } from '@/lib/enrichment/discovery-engine'
import { LinkedInSearchDecisionMakerDiscoveryProvider as provider } from '@/lib/outbound/decision-maker-discovery/providers/linkedin-search'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, TAVILY_API_KEY: 'tavily-key', SERPER_API_KEY: undefined }
})

describe('LinkedInSearchDecisionMakerDiscoveryProvider', () => {
  it('errors without a companyName', async () => {
    const result = await provider.discoverDecisionMakers({ companyName: '', domain: 'acme.com' })
    expect(result.status).toBe('error')
  })

  it('errors with no search API key configured', async () => {
    process.env.TAVILY_API_KEY = ''
    process.env.SERPER_API_KEY = ''
    const result = await provider.discoverDecisionMakers({ companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('search API key')
  })

  it('extracts a candidate whose result title parses to a matching target title', async () => {
    vi.mocked(searchTavily).mockResolvedValue([
      { title: 'Jane Doe - VP Operations - Acme Corp | LinkedIn', url: 'https://linkedin.com/in/janedoe', content: '' },
    ])

    const result = await provider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['VP Operations'],
    })

    expect(result.status).toBe('found')
    expect(result.candidates).toEqual([{
      personName: 'Jane Doe',
      title: 'VP Operations',
      linkedinUrl: 'https://linkedin.com/in/janedoe',
      confidence: 'high',
    }])
  })

  it('drops a result whose url is not a linkedin.com/in/ profile', async () => {
    vi.mocked(searchTavily).mockResolvedValue([
      { title: 'Jane Doe - VP Operations - Acme Corp | LinkedIn', url: 'https://linkedin.com/company/acme', content: '' },
    ])

    const result = await provider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['VP Operations'],
    })

    expect(result.status).toBe('not_found')
    expect(result.candidates).toEqual([])
  })

  it('drops a result with no parseable title rather than fabricating one', async () => {
    vi.mocked(searchTavily).mockResolvedValue([
      { title: 'Jane Doe | LinkedIn', url: 'https://linkedin.com/in/janedoe', content: '' },
    ])

    const result = await provider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['VP Operations'],
    })

    expect(result.status).toBe('not_found')
  })

  it('drops a result whose title shares no word with any requested title', async () => {
    vi.mocked(searchTavily).mockResolvedValue([
      { title: 'Jane Doe - Receptionist - Acme Corp | LinkedIn', url: 'https://linkedin.com/in/janedoe', content: '' },
    ])

    const result = await provider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CEO'],
    })

    expect(result.status).toBe('not_found')
  })

  it('falls back to Serper when Tavily returns nothing', async () => {
    process.env.SERPER_API_KEY = 'serper-key'
    vi.mocked(searchTavily).mockResolvedValue([])
    vi.mocked(searchSerper).mockResolvedValue([
      { title: 'John Smith - CEO - Acme Corp | LinkedIn', url: 'https://linkedin.com/in/johnsmith', content: '' },
    ])

    const result = await provider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CEO'],
    })

    expect(result.status).toBe('found')
    expect(result.candidates).toHaveLength(1)
  })

  it('dedupes results with the same profile url', async () => {
    vi.mocked(searchTavily).mockResolvedValue([
      { title: 'Jane Doe - CEO - Acme Corp | LinkedIn', url: 'https://linkedin.com/in/janedoe', content: '' },
      { title: 'Jane Doe - CEO - Acme Corp | LinkedIn', url: 'https://linkedin.com/in/janedoe', content: '' },
    ])

    const result = await provider.discoverDecisionMakers({
      companyName: 'Acme',
      domain: 'acme.com',
      targetTitles: ['CEO'],
    })

    expect(result.candidates).toHaveLength(1)
  })

  it('isAvailable reflects whether a search API key is configured', async () => {
    expect(await provider.isAvailable()).toBe(true)
    process.env.TAVILY_API_KEY = ''
    process.env.SERPER_API_KEY = ''
    expect(await provider.isAvailable()).toBe(false)
  })
})
