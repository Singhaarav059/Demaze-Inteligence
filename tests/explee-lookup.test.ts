import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lookupCompanyInExplee } from '@/lib/enrichment/explee-lookup'

function mockSearch(companies: Array<{ name: string; domain: string | null }>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ companies, meta: { total: companies.length, results_count: companies.length, credits_charged: 0, remaining_balance: 100 } }),
  }) as unknown as typeof fetch
}

describe('lookupCompanyInExplee', () => {
  const originalFetch = global.fetch
  const originalKey = process.env.EXPLEE_API_KEY

  beforeEach(() => {
    process.env.EXPLEE_API_KEY = 'test-key'
  })
  afterEach(() => {
    global.fetch = originalFetch
    process.env.EXPLEE_API_KEY = originalKey
  })

  it('returns a confirmed match when exactly one result normalizes to the same name', async () => {
    mockSearch([{ name: 'Ador Welding Ltd', domain: 'adorwelding.com' }])
    const result = await lookupCompanyInExplee('Ador Welding')
    expect(result).toEqual({
      status: 'confirmed',
      domain: 'adorwelding.com',
      confidence: 'high',
      candidates: [],
      reason: 'Matched "Ador Welding" to an Explee company record.',
    })
  })

  it('returns null when no result matches', async () => {
    mockSearch([{ name: 'Some Unrelated Company', domain: 'unrelated.com' }])
    expect(await lookupCompanyInExplee('Ador Welding')).toBeNull()
  })

  it('returns null (never guesses) when more than one result matches the normalized name', async () => {
    mockSearch([
      { name: 'Acme Inc', domain: 'acme.com' },
      { name: 'Acme Ltd', domain: 'acme.co.in' },
    ])
    expect(await lookupCompanyInExplee('Acme')).toBeNull()
  })

  it('ignores a matching result with no domain', async () => {
    mockSearch([{ name: 'Ador Welding Ltd', domain: null }])
    expect(await lookupCompanyInExplee('Ador Welding')).toBeNull()
  })

  it('returns null without calling Explee when EXPLEE_API_KEY is unset', async () => {
    delete process.env.EXPLEE_API_KEY
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    expect(await lookupCompanyInExplee('Ador Welding')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null instead of throwing when the Explee call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch
    expect(await lookupCompanyInExplee('Ador Welding')).toBeNull()
  })
})
