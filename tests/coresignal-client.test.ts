// ============================================================
// Coresignal client tests
// ============================================================
// searchCoresignalCompanyIds/collectCoresignalCompany are tested with
// global.fetch mocked, same precedent as tests/edgar-client.test.ts /
// tests/prospeo-client.test.ts. Focus: correct request shape (URL, apikey
// header, pagination params), the retry-on-429/5xx-with-backoff behavior,
// no-retry-on-other-4xx, and the collect endpoint's null-on-404 contract.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getCoresignalApiKey,
  searchCoresignalCompanyIds,
  collectCoresignalCompany,
  CoresignalApiError,
} from '../lib/enrichment/sources/coresignal-client'

describe('getCoresignalApiKey', () => {
  const original = process.env.CORESIGNAL_API_KEY

  afterEach(() => {
    process.env.CORESIGNAL_API_KEY = original
  })

  it('returns null when unset', () => {
    delete process.env.CORESIGNAL_API_KEY
    expect(getCoresignalApiKey()).toBeNull()
  })

  it('returns null when blank', () => {
    process.env.CORESIGNAL_API_KEY = '   '
    expect(getCoresignalApiKey()).toBeNull()
  })

  it('returns the trimmed key when set', () => {
    process.env.CORESIGNAL_API_KEY = '  real-key-123  '
    expect(getCoresignalApiKey()).toBe('real-key-123')
  })
})

describe('searchCoresignalCompanyIds / collectCoresignalCompany', () => {
  const originalFetch = global.fetch
  const originalKey = process.env.CORESIGNAL_API_KEY

  beforeEach(() => {
    global.fetch = vi.fn()
    process.env.CORESIGNAL_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env.CORESIGNAL_API_KEY = originalKey
    vi.restoreAllMocks()
  })

  it('throws immediately when no API key is configured', async () => {
    delete process.env.CORESIGNAL_API_KEY
    await expect(searchCoresignalCompanyIds({ industry: 'Manufacturing' })).rejects.toThrow(CoresignalApiError)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends the apikey header and JSON filter body, parses IDs and the pagination cursor', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-next-page-after': 'cursor-abc' }),
      json: async () => [101, 102, 103],
    } as unknown as Response)

    const result = await searchCoresignalCompanyIds({ industry: 'Manufacturing', country: 'India' })

    expect(result.ids).toEqual([101, 102, 103])
    expect(result.nextAfter).toBe('cursor-abc')

    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(String(url)).toContain('/company_base/search/filter')
    expect(String(url)).toContain('items_per_page=')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ apikey: 'test-key' })
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ industry: 'Manufacturing', country: 'India' })
  })

  it('returns nextAfter=null when there is no next-page header', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), json: async () => [1],
    } as unknown as Response)
    const result = await searchCoresignalCompanyIds({ industry: 'x' })
    expect(result.nextAfter).toBeNull()
  })

  it('retries on 429 honoring Retry-After, then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(global.fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: false, status: 429, headers: new Headers({ 'Retry-After': '1' }),
        text: async () => 'rate limited',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(), json: async () => [1],
      } as unknown as Response)

    const promise = searchCoresignalCompanyIds({ industry: 'x' })
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result.ids).toEqual([1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('retries on a 5xx with exponential backoff, then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(global.fetch)
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), text: async () => 'down' } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => [7] } as unknown as Response)

    const promise = searchCoresignalCompanyIds({ industry: 'x' })
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result.ids).toEqual([7])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('does not retry on 401 — throws immediately', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false, status: 401, headers: new Headers(), text: async () => 'bad key',
    } as unknown as Response)

    await expect(searchCoresignalCompanyIds({ industry: 'x' })).rejects.toThrow(CoresignalApiError)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('throws CoresignalApiError once retries are exhausted on repeated 429s', async () => {
    vi.useFakeTimers()
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false, status: 429, headers: new Headers(), text: async () => 'still limited',
    } as unknown as Response)

    const promise = searchCoresignalCompanyIds({ industry: 'x' })
    const assertion = expect(promise).rejects.toThrow(CoresignalApiError)
    await vi.runAllTimersAsync()
    await assertion
    vi.useRealTimers()
  })

  it('collect returns the parsed record on success', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ id: 42, name: 'Acme Manufacturing', website: 'acme.example.com' }),
    } as unknown as Response)

    const record = await collectCoresignalCompany(42)
    expect(record).toEqual({ id: 42, name: 'Acme Manufacturing', website: 'acme.example.com' })

    const [url, init] = vi.mocked(global.fetch).mock.calls[0]
    expect(String(url)).toContain('/company_base/collect/42')
    expect((init as RequestInit).method).toBe('GET')
  })

  it('collect returns null on a 404 rather than throwing', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false, status: 404, headers: new Headers(), text: async () => 'not found',
    } as unknown as Response)

    const record = await collectCoresignalCompany(999)
    expect(record).toBeNull()
  })

  it('collect throws on a non-404, non-retryable error', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false, status: 400, headers: new Headers(), text: async () => 'bad request',
    } as unknown as Response)

    await expect(collectCoresignalCompany(1)).rejects.toThrow(CoresignalApiError)
  })
})
