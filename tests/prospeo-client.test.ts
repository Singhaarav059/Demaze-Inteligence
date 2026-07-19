// ============================================================
// Prospeo — low-level client tests (real client, mocked global.fetch)
// ============================================================
// See tests/prospeo-providers.test.ts for the Email Finder / Contact
// Enrichment provider tests — those mock this client module entirely
// (vi.mock is file-scoped/hoisted, so it can't coexist in the same file
// as these real-client tests).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callProspeoEnrichPerson } from '@/lib/outbound/shared/prospeo-client'

describe('callProspeoEnrichPerson', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns ok:true with the parsed body on a 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: false, person: { full_name: 'Jane Doe' } }),
    }))

    const result = await callProspeoEnrichPerson('key', { data: { full_name: 'Jane Doe' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.person?.full_name).toBe('Jane Doe')
  })

  it('returns ok:true with the parsed body even on a non-2xx response, as long as JSON came back', async () => {
    // Confirmed via a real live call: Prospeo ships NO_MATCH (and other
    // business-logic outcomes) with a non-2xx HTTP status but a real JSON
    // body — the caller (each provider) interprets error_code, not this
    // client. Only a response with no parseable JSON body at all is ok:false.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: true, error_code: 'INSUFFICIENT_CREDITS' }),
    }))

    const result = await callProspeoEnrichPerson('key', { data: { full_name: 'Jane Doe' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.error_code).toBe('INSUFFICIENT_CREDITS')
  })

  it('returns ok:false with an HTTP status fallback when a non-2xx response has no JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    }))

    const result = await callProspeoEnrichPerson('key', { data: { full_name: 'Jane Doe' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('HTTP 500')
  })

  it('never throws — resolves ok:false on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const result = await callProspeoEnrichPerson('key', { data: { full_name: 'Jane Doe' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('ECONNRESET')
  })

  it('resolves ok:false on malformed/empty JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => null,
    }))

    const result = await callProspeoEnrichPerson('key', { data: { full_name: 'Jane Doe' } })
    expect(result.ok).toBe(false)
  })

  it('sends the API key in the X-KEY header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: false }) })
    vi.stubGlobal('fetch', fetchMock)

    await callProspeoEnrichPerson('secret-key-123', { data: { full_name: 'Jane Doe' } })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.headers['X-KEY']).toBe('secret-key-123')
  })
})
