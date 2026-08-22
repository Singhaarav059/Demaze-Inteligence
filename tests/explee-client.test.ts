import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchExpleeCompanies, ExpleeApiError } from '@/lib/enrichment/sources/explee-client'

describe('explee-client', () => {
  const originalFetch = global.fetch
  const originalKey = process.env.EXPLEE_API_KEY

  beforeEach(() => {
    process.env.EXPLEE_API_KEY = 'test-key'
  })
  afterEach(() => {
    global.fetch = originalFetch
    process.env.EXPLEE_API_KEY = originalKey
  })

  it('sends the X-API-Key header and correct request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ companies: [{ name: 'Acme' }], meta: { total: 1, results_count: 1, credits_charged: 0, remaining_balance: 100 } }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await searchExpleeCompanies({ definition: 'manufacturing company in india' }, 20)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.explee.com/public/api/v1/search/companies',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
      }),
    )
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ filters: { definition: 'manufacturing company in india' }, page: 1, page_size: 20 })
    expect(result.companies).toHaveLength(1)
    expect(result.meta.total).toBe(1)
  })

  it('throws ExpleeApiError with the real detail on a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ detail: 'Insufficient credit balance' }),
    }) as unknown as typeof fetch

    await expect(searchExpleeCompanies({ definition: 'x' })).rejects.toThrow(ExpleeApiError)
    await expect(searchExpleeCompanies({ definition: 'x' })).rejects.toThrow('Insufficient credit balance')
  })

  it('throws when EXPLEE_API_KEY is not set', async () => {
    delete process.env.EXPLEE_API_KEY
    await expect(searchExpleeCompanies({ definition: 'x' })).rejects.toThrow('EXPLEE_API_KEY is not set')
  })
})
