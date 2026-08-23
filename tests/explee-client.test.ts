// ============================================================
// Explee — low-level outbound-capability client tests
// (real client, mocked global.fetch)
// ============================================================
// See tests/explee-providers.test.ts for the Decision-Maker Discovery /
// Email Finder provider tests — those mock this client module entirely.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callExpleeSearchPeople, callExpleeEnrichEmail } from '@/lib/outbound/shared/explee-client'

describe('callExpleeSearchPeople', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns ok:true with the parsed body on a 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ people: [{ first_name: 'Jane', last_name: 'Doe' }], meta: { total: 1, credits_charged: 0 } }),
    }))

    const result = await callExpleeSearchPeople('key', { people_filters: { job_titles: ['CEO'] } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.people?.[0].first_name).toBe('Jane')
  })

  it('returns ok:false with the real detail on a non-2xx response (unlike Prospeo, a non-2xx IS a real error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ detail: 'Insufficient credits' }),
    }))

    const result = await callExpleeSearchPeople('key', { people_filters: { job_titles: ['CEO'] } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Insufficient credits')
  })

  it('returns ok:false with an HTTP status fallback when a non-2xx response has no detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    }))

    const result = await callExpleeSearchPeople('key', { people_filters: { job_titles: ['CEO'] } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('HTTP 500')
  })

  it('never throws — resolves ok:false on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const result = await callExpleeSearchPeople('key', { people_filters: { job_titles: ['CEO'] } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('ECONNRESET')
  })

  it('sends the API key in the X-API-Key header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ people: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await callExpleeSearchPeople('secret-key-123', { people_filters: { job_titles: ['CEO'] } })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers['X-API-Key']).toBe('secret-key-123')
  })
})

describe('callExpleeEnrichEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns ok:true with email + confidence_score on a 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ email: 'jane@acme.com', confidence_score: 0.9, source: 'pattern', meta: { credits_charged: 1.5 } }),
    }))

    const result = await callExpleeEnrichEmail('key', { first_name: 'Jane', last_name: 'Doe', company_domain: 'acme.com' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.email).toBe('jane@acme.com')
  })

  it('returns ok:false with the real detail on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid API key' }),
    }))

    const result = await callExpleeEnrichEmail('key', { first_name: 'Jane', last_name: 'Doe', company_domain: 'acme.com' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Invalid API key')
  })

  it('never throws — resolves ok:false on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    const result = await callExpleeEnrichEmail('key', { first_name: 'Jane', last_name: 'Doe', company_domain: 'acme.com' })
    expect(result.ok).toBe(false)
  })
})
