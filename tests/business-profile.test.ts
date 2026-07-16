import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCompletionMock = vi.fn()

vi.mock('@/lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
}))

import { extractBusinessProfile, emptyBusinessProfile, isEmptyBusinessProfile } from '@/lib/pipeline/business-profile'

function mockResponse(content: string) {
  return {
    content,
    model: 'test-model',
    providerName: 'test-provider',
    tokensUsed: 100,
    latencyMs: 10,
  }
}

describe('emptyBusinessProfile / isEmptyBusinessProfile', () => {
  it('emptyBusinessProfile returns all-empty fields', () => {
    const profile = emptyBusinessProfile()
    expect(profile.services).toEqual([])
    expect(profile.problems_solved).toEqual([])
    expect(profile.ideal_customers).toBe('')
    expect(profile.industries_served).toEqual([])
    expect(profile.target_company_size).toBe('')
    expect(profile.market_positioning).toBe('')
    expect(profile.technical_capabilities).toEqual([])
    expect(profile.business_outcomes).toEqual([])
  })

  it('isEmptyBusinessProfile is true for emptyBusinessProfile()', () => {
    expect(isEmptyBusinessProfile(emptyBusinessProfile())).toBe(true)
  })

  it('isEmptyBusinessProfile is false when any single field is populated', () => {
    expect(isEmptyBusinessProfile({ ...emptyBusinessProfile(), services: ['AI development'] })).toBe(false)
    expect(isEmptyBusinessProfile({ ...emptyBusinessProfile(), market_positioning: 'premium specialist' })).toBe(false)
    expect(isEmptyBusinessProfile({ ...emptyBusinessProfile(), ideal_customers: 'mid-market manufacturers' })).toBe(false)
  })
})

describe('extractBusinessProfile', () => {
  beforeEach(() => {
    getCompletionMock.mockReset()
  })

  it('returns an empty profile without calling the LLM when website content is empty', async () => {
    const profile = await extractBusinessProfile('', 'Acme Corp')
    expect(profile).toEqual(emptyBusinessProfile())
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('parses a clean JSON response into the structured profile', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      services: ['AI development', 'Custom software'],
      problems_solved: ['Manual reporting workflows'],
      ideal_customers: 'Mid-market manufacturers',
      industries_served: ['Manufacturing', 'Automotive'],
      target_company_size: 'SMB and mid-market',
      market_positioning: 'Premium specialist provider',
      technical_capabilities: ['Computer vision', 'LLM integration'],
      business_outcomes: ['Reduced manual data entry'],
    })))

    const profile = await extractBusinessProfile('We are a leading provider of AI development...', 'Acme Corp')

    expect(profile.services).toEqual(['AI development', 'Custom software'])
    expect(profile.problems_solved).toEqual(['Manual reporting workflows'])
    expect(profile.ideal_customers).toBe('Mid-market manufacturers')
    expect(profile.industries_served).toEqual(['Manufacturing', 'Automotive'])
    expect(profile.target_company_size).toBe('SMB and mid-market')
    expect(profile.market_positioning).toBe('Premium specialist provider')
    expect(profile.technical_capabilities).toEqual(['Computer vision', 'LLM integration'])
    expect(profile.business_outcomes).toEqual(['Reduced manual data entry'])
  })

  it('strips ```json fences before parsing (same fence-stripping shape as route.ts)', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(
      '```json\n' + JSON.stringify({ services: ['Web development'] }) + '\n```',
    ))

    const profile = await extractBusinessProfile('some content', 'Acme Corp')
    expect(profile.services).toEqual(['Web development'])
  })

  it('filters out non-string / empty array entries defensively', async () => {
    getCompletionMock.mockResolvedValue(mockResponse(JSON.stringify({
      services: ['Real service', '', 42, null, '  '],
      industries_served: 'not an array',
    })))

    const profile = await extractBusinessProfile('some content', 'Acme Corp')
    expect(profile.services).toEqual(['Real service'])
    expect(profile.industries_served).toEqual([])
  })

  it('returns an empty profile (never throws) when the LLM call fails', async () => {
    getCompletionMock.mockRejectedValue(new Error('network error'))
    const profile = await extractBusinessProfile('some content', 'Acme Corp')
    expect(profile).toEqual(emptyBusinessProfile())
  })

  it('returns an empty profile (never throws) when the response is unparseable JSON', async () => {
    getCompletionMock.mockResolvedValue(mockResponse('not json at all'))
    const profile = await extractBusinessProfile('some content', 'Acme Corp')
    expect(profile).toEqual(emptyBusinessProfile())
  })
})
